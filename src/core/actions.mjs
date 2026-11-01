import path from 'node:path';
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
      return { ...receipt, teamId, viewState };
    } catch (error) {
      throw wrapError(error, request.requestId, teamId);
    }
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

  async list(input = {}) {
    const request = parseList(input);
    const teamsRoot = path.join(this.#lease.root, 'teams');
    let names;
    try { names = await (await import('node:fs/promises')).readdir(teamsRoot, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return { teams: [], cursor: request.cursor }; throw error; }
    const teams = [];
    for (const entry of names.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
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
