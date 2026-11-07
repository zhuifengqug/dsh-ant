import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { TeamError, invariant } from './errors.mjs';
import { parseGet, parseList, parseRequest } from './codec.mjs';
import { requestDigest, stableTeamId } from './canonical.mjs';
import { foldTeam } from './fold.mjs';
import { authorize, decideAction } from './decide.mjs';
import { TeamWal } from './wal.mjs';
import { TeamWriterLease } from './writer-lease.mjs';

function wrapError(error, requestId, teamId) {
  if (error instanceof TeamError) {
    error.details = { requestId, ...(teamId ? { teamId } : {}), ...error.details };
    return error;
  }
  return new TeamError('team/unavailable', 'Team action failed', { requestId, ...(teamId ? { teamId } : {}), retryable: true }, { cause: error });
}

/** Canonical Host owner for Team WAL actions and rebuildable views. */
export class TeamActionService {
  #lease;
  #token;
  #wal;
  #workspaceIdentity;
  #workspaceRoot;
  #config;
  constructor({ workspaceRoot, lease, token, config = {} }) {
    this.#lease = lease;
    this.#token = token;
    this.#workspaceRoot = workspaceRoot;
    this.#workspaceIdentity = lease.workspaceIdentity;
    this.#config = { includeArchived: false, ...config };
    this.#wal = new TeamWal({ lease, token });
  }
  get lease() { return this.#lease; }
  get workspaceRoot() { return this.#workspaceRoot; }
  get wal() { return this.#wal; }

  async dispatch(input, context) {
    const request = parseRequest(input);
    const teamId = request.teamId ?? stableTeamId(this.#workspaceIdentity, request.requestId);
    try {
      const receipt = await this.#wal.transact(teamId, request, context, async history => {
        const view = history.events.length ? foldTeam(history.events) : undefined;
        return decideAction(view, request, { ...context, teamId });
      }, async (history, checkedRequest) => {
        const view = history.events.length ? foldTeam(history.events) : undefined;
        authorize(checkedRequest, { ...context, teamId }, view);
      });
      let viewState = receipt.viewState;
      try {
        const history = await this.#wal.read(teamId);
        const view = foldTeam(history.events);
        if (view) await this.#wal.writeSnapshot(teamId, { ...view, cursor: history.cursor }, { cursor: history.cursor, walDigest: history.walDigest });
      } catch (error) {
        viewState = 'rebuild-required';
        if (!(error instanceof TeamError)) throw error;
      }
      let archival;
      if (request.action === 'team.archive') {
        try { archival = await this.#advanceArchive(teamId); }
        catch (error) { if (!(error instanceof TeamError)) throw error; archival = 'failed'; }
      }
      return { ...receipt, teamId, viewState, ...(archival ? { archival } : {}) };
    } catch (error) {
      throw wrapError(error, request.requestId, teamId);
    }
  }

  /** Archive is a physical retirement: drain, move the directory, then mark it archived. */
  async #advanceArchive(teamId) {
    const history = await this.#wal.read(teamId);
    const view = foldTeam(history.events);
    if (view.lifecycle === 'archived') return 'complete';
    if (view.lifecycle !== 'archiving') return 'pending';
    await this.#wal.appendInternal(teamId, [{ type: 'team.drain-complete', payload: { attempts: view.attempts.length, activeMembers: view.members.filter(item => item.status === 'active').length } }], `internal.drain-complete.${history.cursor + 1}`);
    const move = await this.#wal.archiveTeam(teamId);
    const retired = await this.#wal.read(teamId);
    await this.#wal.appendInternal(teamId, [{ type: 'team.archived', payload: { archivedAt: new Date().toISOString() } }], `internal.archived.${retired.cursor + 1}`);
    return move;
  }

  async get(input) {
    const request = parseGet(input);
    const history = await this.#wal.read(request.teamId);
    if (!history.events.length) throw new TeamError('team/not-found', 'Team does not exist', { teamId: request.teamId, retryable: false });
    const view = foldTeam(history.events);
    if (request.atLeastEventSeq !== undefined && history.cursor < request.atLeastEventSeq) {
      throw new TeamError('team/unavailable', 'Requested cursor is not available yet', { teamId: request.teamId, eventSeq: history.cursor, retryable: true });
    }
    return { ...view, cursor: history.cursor, walDigest: history.walDigest };
  }

  async admitMail(input) {
    const receipt = await this.#wal.admitMail(input);
    const history = await this.#wal.read(input.teamId);
    const view = foldTeam(history.events);
    if (view) await this.#wal.writeSnapshot(input.teamId, { ...view, cursor: history.cursor }, { cursor: history.cursor, walDigest: history.walDigest });
    return receipt;
  }

  async pendingMail() {
    const teamsRoot = path.join(this.#lease.root, 'teams');
    let names;
    try { names = await readdir(teamsRoot, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const pending = [];
    for (const entry of names.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const history = await this.#wal.read(entry.name);
      const view = foldTeam(history.events);
      if (view?.lifecycle === 'archived' || view?.lifecycle === 'deleting') continue;
      for (const mail of view?.mailbox ?? []) if (mail.state === 'queued') pending.push({ teamId: entry.name, mail: structuredClone(mail) });
    }
    return pending;
  }

  async list(input = {}) {
    const request = parseList(input);
    const names = [];
    for (const teamsRoot of [path.join(this.#lease.root, 'teams'), path.join(this.#lease.root, 'archive')]) {
      try {
        for (const entry of await readdir(teamsRoot, { withFileTypes: true })) if (entry.isDirectory()) names.push({ isDirectory: () => true, name: entry.name });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const seen = new Set();
    const teams = [];
    for (const entry of names.filter(item => !seen.has(item.name) && seen.add(item.name)).sort((a, b) => a.name.localeCompare(b.name))) {
      try {
        const view = await this.get({ teamId: entry.name });
        if (view.lifecycle === 'archived' && !request.includeArchived) continue;
        teams.push({ teamId: view.teamId, goal: view.goal, lifecycle: view.lifecycle, cursor: view.cursor, walDigest: view.walDigest });
      } catch (error) {
        if (error instanceof TeamError && error.code === 'team/rebuild-required') teams.push({ teamId: entry.name, lifecycle: 'needs_attention', viewState: 'rebuild-required' });
        else if (!(error instanceof TeamError && error.code === 'team/not-found')) throw error;
      }
    }
    const limit = request.limit ?? 100;
    const offset = request.cursor ? Number.parseInt(request.cursor, 10) : 0;
    invariant(Number.isSafeInteger(offset) && offset >= 0, 'team/invalid-action', 'Invalid list cursor');
    return { teams: teams.slice(offset, offset + limit), cursor: offset + limit < teams.length ? String(offset + limit) : undefined };
  }

  async close() { await this.#lease.release(this.#token.ownerId, this.#token.epoch, this.#token.fencingToken); }
}

export async function createTeamActionService({ workspaceRoot, ownerId, config }) {
  const lease = new TeamWriterLease();
  const token = await lease.acquire(workspaceRoot, ownerId);
  return new TeamActionService({ workspaceRoot, lease, token, config });
}
