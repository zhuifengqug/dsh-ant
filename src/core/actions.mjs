import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { TeamError, invariant } from './errors.mjs';
import { parseGet, parseList, parseRequest } from './codec.mjs';
import { goalTeamId, requestDigest, stableTeamId, teamFingerprint } from './canonical.mjs';
import { foldTeam } from './fold.mjs';
import { withGateQueues } from './gate.mjs';
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

  /** Settings are read per action, so a saved change tunes the very next dispatch. */
  async #settings() {
    const readSettings = this.#config.readSettings;
    if (typeof readSettings !== 'function') return {};
    try { return await readSettings(); } catch { return {}; }
  }

  async dispatch(input, context) {
    const request = parseRequest(input);
    const settings = await this.#settings();
    const fingerprint = request.action === 'team.create' && !request.teamId ? teamFingerprint(request.payload) : undefined;
    const teamId = request.teamId ?? (fingerprint && !request.payload.rerun ? goalTeamId(this.#workspaceIdentity, fingerprint) : stableTeamId(this.#workspaceIdentity, request.requestId));
    try {
      await this.#authorizeRequest(request, context, teamId);
      if (fingerprint) {
        const replayed = await this.#replayCreate(request, teamId, fingerprint);
        if (replayed) return replayed;
      }
      if (request.action === 'team.delete') {
        const replayed = await this.#replayDelete(request, teamId);
        if (replayed) return replayed;
      }
      const receipt = await this.#wal.transact(teamId, request, context, async history => {
        const view = history.events.length ? foldTeam(history.events) : undefined;
        return decideAction(view, request, { ...context, teamId, settings });
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
      const effects = {};
      if (request.action === 'team.archive') {
        try { effects.archival = await this.#advanceArchive(teamId); }
        catch (error) { if (!(error instanceof TeamError)) throw error; effects.archival = 'failed'; }
      }
      if (request.action === 'team.restore') {
        try { effects.restoration = await this.#advanceRestore(teamId); }
        catch (error) { if (!(error instanceof TeamError)) throw error; effects.restoration = 'failed'; }
      }
      if (request.action === 'team.delete') effects.deletion = await this.#advanceDelete(teamId, receipt, requestDigest(request));
      return { ...receipt, teamId, viewState, ...effects };
    } catch (error) {
      throw wrapError(error, request.requestId, teamId);
    }
  }

  /** Authorisation runs before every replay short-circuit so a denied caller learns nothing about state. */
  async #authorizeRequest(request, context, teamId) {
    let view;
    try {
      const history = await this.#wal.read(teamId);
      view = history.events.length ? foldTeam(history.events) : undefined;
    } catch (error) {
      if (!(error instanceof TeamError && error.code === 'team/not-found')) throw error;
    }
    authorize(request, { ...context, teamId }, view);
  }

  /** The same goal and task set never starts a second round of dispatch unless rerun is explicit. */
  async #replayCreate(request, teamId, fingerprint) {
    let view;
    try { view = await this.get({ teamId }); }
    catch (error) { if (error instanceof TeamError && error.code === 'team/not-found') return undefined; throw error; }
    if (view.fingerprint !== fingerprint) throw new TeamError('team/conflict', 'Team identity collides with a different goal', { requestId: request.requestId, teamId, retryable: false });
    return { outcome: 'duplicate', requestId: request.requestId, teamId, firstEventSeq: view.cursor, lastEventSeq: view.cursor, eventIds: [], viewState: 'ready' };
  }

  /** A removed team leaves a tombstone so the same delete replays as a duplicate instead of a conflict. */
  async #replayDelete(request, teamId) {
    const tombstone = await this.#wal.readTombstone(teamId);
    if (tombstone) {
      if (tombstone.requestId === request.requestId && tombstone.payloadDigest === requestDigest(request)) {
        return { ...tombstone.receipt, outcome: 'duplicate', teamId, viewState: 'ready', deletion: 'duplicate' };
      }
      throw new TeamError('team/not-found', 'Team does not exist', { requestId: request.requestId, teamId, retryable: false });
    }
    let view;
    try { view = await this.get({ teamId }); }
    catch (error) { if (error instanceof TeamError && error.code === 'team/not-found') return undefined; throw error; }
    if (view.lifecycle !== 'deleting') return undefined;
    const receipt = { outcome: 'duplicate', requestId: request.requestId, teamId, firstEventSeq: view.cursor, lastEventSeq: view.cursor, eventIds: [], viewState: 'ready' };
    return { ...receipt, deletion: await this.#advanceDelete(teamId, receipt, requestDigest(request)) };
  }

  async #advanceRestore(teamId) {
    const view = foldTeam((await this.#wal.read(teamId)).events);
    if (view.lifecycle === 'archived') return 'pending';
    return this.#wal.restoreTeam(teamId);
  }

  /** Deletion cleans the lineage first, then removes the directory, then records the tombstone. */
  async #advanceDelete(teamId, receipt, payloadDigest) {
    const history = await this.#wal.read(teamId);
    const view = foldTeam(history.events);
    if (view.lifecycle !== 'deleting') return 'pending';
    const sessions = view.cleanupIntent?.memberSessions ?? [];
    const retire = this.#config.retireSession;
    for (const sessionId of sessions) {
      if (typeof retire !== 'function') throw new TeamError('team/persistence-failed', 'Session retirement is not configured', { teamId, sessionId, retryable: true });
      let retired;
      try { retired = await retire(sessionId); }
      catch (cause) { throw new TeamError('team/persistence-failed', 'Session retirement failed', { teamId, sessionId, retryable: true }, { cause }); }
      if (retired === false) throw new TeamError('team/persistence-failed', 'Session retirement was not confirmed', { teamId, sessionId, retryable: true });
    }
    const removal = await this.#wal.deleteTeam(teamId);
    await this.#wal.writeTombstone(teamId, { schemaVersion: 1, teamId, requestId: receipt.requestId, payloadDigest, receipt: { ...receipt, eventIds: [...receipt.eventIds] }, sessions, removedAt: new Date().toISOString() });
    return removal;
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
    return withGateQueues({ ...view, cursor: history.cursor, walDigest: history.walDigest });
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
