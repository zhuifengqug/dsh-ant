import { canonicalize, digest } from './canonical.mjs';
import { TeamError, invariant } from './errors.mjs';

const fail = (condition, message) => invariant(condition, 'team/rebuild-required', message);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 1;
const identity = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
function exact(value, fields, optional = []) {
  fail(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected persisted object');
  fail(fields.every(key => Object.hasOwn(value, key)), 'Missing persisted field');
  fail(Object.keys(value).every(key => fields.includes(key) || optional.includes(key)), 'Unknown persisted field');
}
function jsonObject(value) {
  fail(value !== null && typeof value === 'object' && !Array.isArray(value), 'Event payload must be an object');
  canonicalize(value);
}
function event(value) {
  exact(value, ['schemaVersion', 'eventId', 'teamId', 'eventSeq', 'causationId', 'idempotencyKey', 'payloadDigest', 'aggregateVersion', 'occurredAt', 'actor', 'type', 'payload'], ['principal', 'attemptId']);
  fail(value.schemaVersion === 1 && identity(value.eventId) && identity(value.teamId), 'Invalid event identity/schema');
  fail(integer(value.eventSeq) && value.aggregateVersion === value.eventSeq, 'Invalid aggregate version');
  fail(identity(value.causationId) && identity(value.idempotencyKey) && hash(value.payloadDigest), 'Invalid event request metadata');
  fail(typeof value.occurredAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.occurredAt) && Number.isFinite(Date.parse(value.occurredAt)), 'Invalid event timestamp');
  fail(['user', 'agent', 'system'].includes(value.actor) && typeof value.type === 'string' && /^[a-z][a-z0-9.-]{0,127}$/.test(value.type), 'Invalid event actor/type');
  if (Object.hasOwn(value, 'attemptId')) fail(identity(value.attemptId), 'Invalid attempt identity');
  if (Object.hasOwn(value, 'principal')) {
    exact(value.principal, ['kind']);
    fail(value.principal.kind === 'owner', 'Unknown principal kind');
  }
  jsonObject(value.payload);
}
function receipt(value) {
  exact(value, ['outcome', 'requestId', 'teamId', 'firstEventSeq', 'lastEventSeq', 'eventIds', 'viewState']);
  fail(value.outcome === 'committed' && identity(value.requestId) && identity(value.teamId), 'Invalid persisted receipt');
  fail(integer(value.firstEventSeq) && integer(value.lastEventSeq) && value.lastEventSeq >= value.firstEventSeq, 'Invalid receipt range');
  fail(Array.isArray(value.eventIds) && value.eventIds.length > 0 && value.eventIds.every(identity), 'Invalid receipt eventIds');
  fail(['ready', 'rebuild-required'].includes(value.viewState), 'Invalid receipt view state');
}
function persisted(operation) {
  try { return operation(); }
  catch (cause) {
    if (cause instanceof TeamError && cause.code === 'team/rebuild-required') throw cause;
    throw new TeamError('team/rebuild-required', 'Invalid persisted JSON shape', {}, { cause });
  }
}
export function validateTransaction(record) {
  return persisted(() => {
    canonicalize(record);
    exact(record, ['schemaVersion', 'teamId', 'requestId', 'payloadDigest', 'firstEventSeq', 'lastEventSeq', 'events', 'receipt', 'checksum']);
    fail(record.schemaVersion === 1 && identity(record.teamId) && identity(record.requestId) && hash(record.payloadDigest) && hash(record.checksum), 'Invalid transaction metadata');
    fail(integer(record.firstEventSeq) && integer(record.lastEventSeq), 'Invalid transaction range');
    fail(Array.isArray(record.events) && record.events.length > 0 && record.events.length <= 1024, 'Invalid event batch');
    record.events.forEach(event); receipt(record.receipt);
    const { checksum, ...body } = record;
    fail(checksum === digest(body), 'WAL transaction checksum mismatch');
    return record;
  });
}
export function validateSnapshot(snapshot) {
  return persisted(() => {
    canonicalize(snapshot);
    exact(snapshot, ['schemaVersion', 'teamId', 'lastEventSeq', 'walDigest', 'state', 'checksum']);
    fail(snapshot.schemaVersion === 1 && identity(snapshot.teamId) && integer(snapshot.lastEventSeq) && hash(snapshot.walDigest) && hash(snapshot.checksum), 'Invalid snapshot metadata');
    jsonObject(snapshot.state);
    const { checksum, ...body } = snapshot;
    fail(checksum === digest(body), 'Snapshot checksum mismatch');
    return snapshot;
  });
}
export function validateChanges(changes) {
  try {
    canonicalize(changes);
    invariant(Array.isArray(changes) && changes.length > 0 && changes.length <= 1024, 'team/invalid-state', 'Transaction must produce a bounded event batch');
    for (const change of changes) {
      exact(change, ['type', 'payload'], ['attemptId']);
      fail(typeof change.type === 'string' && /^[a-z][a-z0-9.-]{0,127}$/.test(change.type), 'Invalid change type');
      if (change.attemptId !== undefined) fail(identity(change.attemptId), 'Invalid change attemptId');
      jsonObject(change.payload);
    }
    return changes;
  } catch (cause) { throw new TeamError('team/invalid-state', 'Decision produced an invalid event batch', {}, { cause }); }
}
