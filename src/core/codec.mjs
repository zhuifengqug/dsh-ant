import { TeamError } from './errors.mjs';
import { canonicalize } from './canonical.mjs';

const text = { type: 'string', minLength: 1, maxLength: 65536 };
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' };
const strings = { type: 'array', items: text, maxItems: 256 };
const optional = schema => ({ optional: true, schema });
const array = items => ({ type: 'array', items, maxItems: 256 });
const choice = (...values) => ({ type: 'string', enum: values });
function object(fields) {
  return {
    type: 'object', additionalProperties: false,
    properties: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.optional ? value.schema : value])),
    required: Object.entries(fields).filter(([, value]) => !value.optional).map(([key]) => key),
  };
}
const modelFields = { provider: text, model: text, reasoningEffort: optional(text) };
const task = object({ taskId: id, title: text, objective: text, inScope: strings, outOfScope: strings, acceptance: strings, verify: strings, ownerMemberId: optional(id), readOnly: optional({ type: 'boolean' }) });
const dependency = object({ taskId: id, blockedByTaskId: id });
const qualityGate = object({ gateId: id, taskId: id, kind: choice('verification', 'review', 'integration'), acceptance: strings });
const plan = object({ planId: id, mode: choice('normal', 'fast'), tasks: array(task), dependencies: array(dependency), qualityGates: array(qualityGate), maxActiveAttempts: { type: 'integer', minimum: 1, maximum: 8 }, memberDelegation: optional({ type: 'boolean' }) });
const member = object({ memberId: id, role: text, sessionMode: choice('persistent', 'ephemeral'), sessionId: optional(id), ...modelFields, inScope: strings, outOfScope: strings, executionPrompt: optional(text) });
const evidence = object({ kind: choice('file', 'command', 'session', 'event'), locator: text, digest: optional(text), note: optional(text) });
const attempt = { taskId: id, attemptId: id };
const taskPatch = object({ title: optional(text), objective: optional(text), inScope: optional(strings), outOfScope: optional(strings), acceptance: optional(strings), verify: optional(strings), ownerMemberId: optional(id), readOnly: optional({ type: 'boolean' }) });

export const payloadSchemas = {
  'team.create': object({ goal: text, workspaceRelativePath: { type: 'string', minLength: 1, maxLength: 4096 }, plan, members: array(member), leadMemberId: optional(id), rerun: optional({ type: 'boolean' }) }),
  'plan.confirm': object({ planDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' } }),
  'plan.amend': object({ plan, reason: text }),
  'attempt.dispatch': object({ taskId: id, memberId: id, variants: optional({ type: 'integer', minimum: 1, maximum: 3 }) }),
  'attempt.pause': object(attempt),
  'attempt.resume': object(attempt),
  'attempt.takeover': object(attempt),
  'attempt.terminate': object({ ...attempt, reason: optional(text) }),
  'attempt.retry': object({ taskId: id, previousAttemptId: id, memberId: id }),
  'member.invite': object({ sessionId: id, role: text, parentMemberId: optional(id) }),
  'member.hatch': object({ memberId: id, sessionId: id }),
  'member.accept': object({ invitationId: id }),
  'member.remove': object({ memberId: id }),
  'member.changeModel': object({ memberId: id, ...modelFields }),
  'mail.send': object({ messageId: id, toMemberId: id, content: text, deliveryMode: choice('queue', 'steer'), taskId: optional(id), attemptId: optional(id) }),
  'mail.read': object({ messageId: id }),
  'mail.consume': object({ messageId: id }),
  'quality.report': object({ ...attempt, verdict: choice('pass', 'fail'), summary: text, evidence: array(evidence) }),
  'task.create': object({ task, dependencies: optional(array(dependency)), qualityGates: optional(array(qualityGate)), reason: optional(text) }),
  'task.amend': object({ taskId: id, patch: taskPatch, reason: text }),
  'task.reassign': object({ taskId: id, memberId: id, reason: optional(text) }),
  'task.claim': object({ taskId: id, memberId: id }),
  'task.complete': object({ ...attempt, summary: text, evidence: array(evidence) }),
  'quality.review': object({ ...attempt, reviewerMemberId: id, verdict: choice('pass', 'fail'), criteria: strings, summary: text, gateId: optional(id) }),
  'batch.release': object({ batchId: id, taskIds: { type: 'array', items: id, maxItems: 256 } }),
  'attempt.select': object({ ...attempt, variant: { type: 'integer', minimum: 1, maximum: 3 } }),
  'spend.record': object({ ...attempt, tokensIn: optional({ type: 'integer', minimum: 0 }), tokensOut: optional({ type: 'integer', minimum: 0 }), costMicros: optional({ type: 'integer', minimum: 0 }), model: optional(text), source: optional(text) }),
  'run.interrupted': object({ reason: text, kind: optional(choice('aborted', 'output-limit', 'error', 'timeout')), taskId: optional(id), attemptId: optional(id) }),
  'team.archive': object({}),
  'team.restore': object({}),
  'team.halt': object({ reason: optional(text) }),
  'team.resume': object({}),
  'team.delete': object({}),
};
export const ACTIONS = Object.freeze(Object.keys(payloadSchemas));
const cursor = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export const requestSchema = {
  oneOf: ACTIONS.map(action => object({ requestId: id, action: { const: action }, payload: payloadSchemas[action], ...(action === 'team.create' ? {} : { teamId: id }), expectedEventSeq: optional(cursor) })),
};
export const getSchema = object({ teamId: id, atLeastEventSeq: optional(cursor) });
export const listSchema = object({ includeArchived: optional({ type: 'boolean' }), cursor: optional(text), limit: optional({ type: 'integer', minimum: 1, maximum: 100 }) });

export function validate(schema, value, path = '$') {
  const fail = message => { throw new TeamError('team/invalid-action', `${path}: ${message}`); };
  if ('const' in schema && value !== schema.const) fail(`expected ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) fail('unexpected enum value');
  if (schema.type === 'object') {
    if (value === null || Array.isArray(value) || typeof value !== 'object') fail('expected object');
    for (const key of schema.required) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) fail(`unexpected ${key}`);
      validate(schema.properties[key], value[key], `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems) fail('expected bounded array');
    for (let i = 0; i < value.length; i++) validate(schema.items, value[i], `${path}[${i}]`);
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) fail('integer out of range');
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 65536)) fail('expected bounded string');
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail('invalid identifier');
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') fail('expected boolean');
  return value;
}

export function parseRequest(input) {
  const value = JSON.parse(canonicalize(input));
  if (!value || !Object.hasOwn(payloadSchemas, value.action)) throw new TeamError('team/invalid-action', 'Unknown action');
  const schema = requestSchema.oneOf[ACTIONS.indexOf(value.action)];
  validate(schema, value);
  return value;
}

export function parseGet(input) {
  const value = JSON.parse(canonicalize(input));
  return validate(getSchema, value);
}
export function parseList(input) {
  const value = JSON.parse(canonicalize(input));
  return validate(listSchema, value);
}
