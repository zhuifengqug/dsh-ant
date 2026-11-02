import path from 'node:path';
import { readdir, readFile, open, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { digest, canonicalize, requestDigest, stableMailAdmissionRequestId, stableTeamId } from './canonical.mjs';
import { parseRequest } from './codec.mjs';
import { foldTeam } from './fold.mjs';
import { TeamError, invariant } from './errors.mjs';
import { atomicReplace, syncDirectory, ensureDirectory } from './writer-lease.mjs';
import { validateTransaction, validateSnapshot, validateChanges } from './wal-schema.mjs';

const teamPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const reservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const recordPattern = /^\d{16}\.json$/;
const badWal = (condition, message) => invariant(condition, 'team/rebuild-required', message);
// A lease is the root writer owner: every WAL facade using it shares the same team queues.
const queues = new WeakMap();

/** Immutable transaction files are the sole durable team owner; snapshot is disposable. */
export class TeamWal {
  #root; #lease; #token; #tails;
  constructor({ lease, token }) {
    this.#lease = lease; this.#token = token; this.#root = lease.root;
    invariant(this.#root, 'team/lease-lost', 'Acquire lease before creating WAL');
    if (!queues.has(lease)) queues.set(lease, new Map());
    this.#tails = queues.get(lease);
  }
  directory(teamId) {
    invariant(teamPattern.test(teamId) && !reservedName.test(teamId), 'team/invalid-action', 'Invalid team directory identity');
    return path.join(this.#root, 'teams', teamId);
  }
  async read(teamId) {
    const directory = path.join(this.directory(teamId), 'events');
    let names;
    try { names = await readdir(directory); }
    catch (error) { if (error.code === 'ENOENT') return { events: [], receipts: [], cursor: 0, walDigest: digest([]) }; throw error; }
    badWal(names.every(name => recordPattern.test(name) || /^\.txn-[a-f0-9-]+\.tmp$/.test(name)), 'Unrecognized WAL entry');
    const events = [], receipts = [], ids = new Set(), requests = new Set(), checksums = [];
    for (const name of names.filter(name => recordPattern.test(name)).sort()) {
      let record;
      try { record = validateTransaction(JSON.parse(await readFile(path.join(directory, name), 'utf8'))); }
      catch (cause) { throw new TeamError('team/rebuild-required', `Unreadable WAL ${name}`, { teamId }, { cause }); }
      const { checksum, ...body } = record;
      badWal(body.teamId === teamId && body.firstEventSeq === events.length + 1 && name === `${String(body.firstEventSeq).padStart(16, '0')}.json`, 'WAL sequence gap or identity mismatch');
      badWal(!requests.has(body.requestId), 'Duplicate WAL request');
      const first = events.length + 1;
      for (const event of body.events) {
        badWal(event.teamId === teamId && event.eventSeq === events.length + 1, 'Invalid event sequence');
        badWal(!ids.has(event.eventId), 'Duplicate eventId');
        badWal((events.length === 0 && event.causationId === 'root') || ids.has(event.causationId), 'Unresolved causationId');
        badWal(event.idempotencyKey === body.requestId && event.payloadDigest === body.payloadDigest, 'Event request mismatch');
        ids.add(event.eventId); events.push(event);
      }
      badWal(body.lastEventSeq === events.length && body.receipt.firstEventSeq === first && body.receipt.lastEventSeq === events.length && body.receipt.teamId === teamId && body.receipt.requestId === body.requestId && digest(body.receipt.eventIds) === digest(body.events.map(event => event.eventId)), 'Invalid transaction receipt');
      requests.add(body.requestId);
      receipts.push({ requestId: body.requestId, payloadDigest: body.payloadDigest, receipt: body.receipt });
      checksums.push(checksum);
    }
    return { events, receipts, cursor: events.length, walDigest: digest(checksums) };
  }
  #serial(teamId, work) {
    this.directory(teamId);
    const previous = this.#tails.get(teamId) ?? Promise.resolve();
    const result = previous.then(() => this.#lease.guard(this.#token, work));
    const tail = result.catch(() => {});
    this.#tails.set(teamId, tail);
    void tail.then(() => { if (this.#tails.get(teamId) === tail) this.#tails.delete(teamId); });
    return result;
  }
  /** Authorize before duplicate lookup; duplicate precedes CAS and state transition. */
  transact(teamId, input, { actor, principal } = {}, decide, authorize = () => {}) {
    return this.#serial(teamId, async () => {
      const request = parseRequest(input);
      if (request.action === 'team.create') {
        invariant(teamId === stableTeamId(this.#lease.workspaceIdentity, request.requestId), 'team/invalid-action', 'Create identity belongs to the workspace/request owner');
      } else invariant(request.teamId === teamId, 'team/invalid-action', 'Request team mismatch');
      invariant(['user', 'agent', 'system'].includes(actor), 'team/forbidden', 'Trusted actor required');
      const history = await this.read(teamId);
      await authorize(history, request);
      const payloadDigest = requestDigest(request);
      const old = history.receipts.find(item => item.requestId === request.requestId);
      if (old) {
        invariant(old.payloadDigest === payloadDigest, 'team/duplicate-request-conflict', 'Request identity reused with different payload', { requestId: request.requestId, teamId });
        return { ...old.receipt, outcome: 'duplicate' };
      }
      invariant(request.expectedEventSeq === undefined || request.expectedEventSeq === history.cursor, 'team/stale-cursor', 'WAL cursor has changed', { requestId: request.requestId, teamId, eventSeq: history.cursor });
      const changes = validateChanges(await decide(history, request));
      return this.#appendChanges(teamId, history, request.requestId, payloadDigest, actor, principal, changes);
    });
  }
  /** Persist the external Session admission as a Team-owned WAL fact. */
  admitMail({ teamId, messageId, sessionId, deliveryMode, accepted }) {
    return this.#serial(teamId, async () => {
      invariant(typeof messageId === 'string' && typeof sessionId === 'string', 'team/invalid-action', 'Mailbox admission identity is required');
      invariant(['queue', 'steer'].includes(deliveryMode) && accepted === true, 'team/invalid-action', 'Only accepted Session prompts can be admitted');
      const history = await this.read(teamId);
      const requestId = stableMailAdmissionRequestId(teamId, messageId);
      const payload = { messageId, sessionId, deliveryMode, accepted: true };
      const payloadDigest = digest({ type: 'mail.admitted', payload });
      const existingEvent = history.events.find(event => event.idempotencyKey === requestId);
      if (existingEvent) {
        invariant(existingEvent.payloadDigest === payloadDigest && existingEvent.type === 'mail.admitted' && digest(existingEvent.payload) === digest(payload), 'team/duplicate-request-conflict', 'Admission request identity reused with different fact', { requestId, teamId });
        return { outcome: 'duplicate', requestId, teamId, firstEventSeq: existingEvent.eventSeq, lastEventSeq: existingEvent.eventSeq, eventIds: [existingEvent.eventId], viewState: 'ready' };
      }
      const view = foldTeam(history.events);
      const mail = view?.mailbox.find(item => item.messageId === messageId);
      invariant(mail && mail.state === 'queued', 'team/invalid-state', 'Queued mailbox message is required for admission');
      const member = view.members.find(item => item.memberId === mail.toMemberId);
      invariant(member?.status === 'active' && member.sessionId === sessionId, 'team/forbidden', 'Admission recipient is no longer an active Session member');
      invariant(mail.toSessionId === sessionId && mail.deliveryMode === deliveryMode, 'team/forbidden', 'Admission does not match queued mailbox recipient');
      return this.#appendChanges(teamId, history, requestId, payloadDigest, 'system', undefined, validateChanges([{ type: 'mail.admitted', payload, ...(mail.attemptId ? { attemptId: mail.attemptId } : {}) }]));
    });
  }
  async #appendChanges(teamId, history, requestId, payloadDigest, actor, principal, changes) {
    let cause = history.events.at(-1)?.eventId ?? 'root';
    const events = changes.map((change, index) => {
      const event = {
        schemaVersion: 1, eventId: randomUUID(), teamId, eventSeq: history.cursor + index + 1,
        causationId: cause, idempotencyKey: requestId, payloadDigest,
        aggregateVersion: history.cursor + index + 1, occurredAt: new Date().toISOString(), actor,
        type: change.type, payload: change.payload,
      };
      if (principal) event.principal = { kind: principal.kind };
      if (change.attemptId) event.attemptId = change.attemptId;
      cause = event.eventId;
      return event;
    });
    const receipt = { outcome: 'committed', requestId, teamId, firstEventSeq: history.cursor + 1, lastEventSeq: history.cursor + events.length, eventIds: events.map(event => event.eventId), viewState: 'ready' };
    const body = { schemaVersion: 1, teamId, requestId, payloadDigest, firstEventSeq: receipt.firstEventSeq, lastEventSeq: receipt.lastEventSeq, events, receipt };
    const record = { ...body, checksum: digest(body) };
    try { validateTransaction(record); }
    catch (cause) { throw new TeamError('team/invalid-state', 'Invalid transaction producer', {}, { cause }); }
    await this.#append(teamId, record);
    return receipt;
  }
  async #append(teamId, record) {
    const directory = path.join(this.directory(teamId), 'events');
    const temporary = path.join(directory, `.txn-${randomUUID()}.tmp`);
    const destination = path.join(directory, `${String(record.firstEventSeq).padStart(16, '0')}.json`);
    try {
      await ensureDirectory(directory);
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(`${canonicalize(record)}\n`, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await this.#lease.assert(this.#token);
      await link(temporary, destination);
      await syncDirectory(directory);
    } catch (cause) {
      if (cause instanceof TeamError) throw cause;
      throw new TeamError('team/persistence-failed', 'WAL transaction commit failed', { teamId, requestId: record.requestId, retryable: true }, { cause });
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  /** A caller must name the exact WAL cut used to build state. Stale cuts are discarded. */
  writeSnapshot(teamId, state, cut) {
    return this.#serial(teamId, async () => {
      invariant(cut && Number.isSafeInteger(cut.cursor) && typeof cut.walDigest === 'string', 'team/invalid-state', 'Snapshot requires its original WAL cut');
      const history = await this.read(teamId);
      if (cut.cursor !== history.cursor || cut.walDigest !== history.walDigest) return false;
      if (Object.hasOwn(state, 'cursor')) invariant(state.cursor === cut.cursor, 'team/invalid-state', 'Snapshot state/cursor mismatch');
      const body = { schemaVersion: 1, teamId, lastEventSeq: cut.cursor, walDigest: cut.walDigest, state };
      const snapshot = { ...body, checksum: digest(body) };
      validateSnapshot(snapshot);
      await atomicReplace(path.join(this.directory(teamId), 'snapshot.json'), canonicalize(snapshot));
      return true;
    });
  }
  async readSnapshot(teamId) {
    let snapshot;
    try { snapshot = validateSnapshot(JSON.parse(await readFile(path.join(this.directory(teamId), 'snapshot.json'), 'utf8'))); }
    catch (error) {
      if (error.code === 'ENOENT') return undefined;
      if (error instanceof TeamError && error.code === 'team/rebuild-required') throw error;
      throw new TeamError('team/rebuild-required', 'Snapshot cannot be read', { teamId }, { cause: error });
    }
    const history = await this.read(teamId);
    if (snapshot.teamId !== teamId || snapshot.lastEventSeq !== history.cursor || snapshot.walDigest !== history.walDigest || (Object.hasOwn(snapshot.state, 'cursor') && snapshot.state.cursor !== history.cursor)) return undefined;
    return snapshot.state;
  }
}
