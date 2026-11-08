import { TeamError, invariant } from '../core/errors.mjs';

function stringId(value, label) {
  invariant(typeof value === 'string' && value.length > 0, 'team/forbidden', `${label} is required`);
  return value;
}

export function ownerContext(principal = { kind: 'owner' }) {
  invariant(principal && principal.kind === 'owner', 'team/forbidden', 'Owner principal required');
  return { actor: 'user', principal: { kind: 'owner' } };
}

export function remoteContext(invocation) {
  const principal = invocation?.peer?.principal;
  invariant(principal && typeof principal === 'object', 'team/forbidden', 'Trusted Remote principal is required');
  invariant(principal.kind === 'owner', 'team/forbidden', 'Owner principal required');
  return ownerContext(principal);
}

export function agentContext(agent, { teamId, memberId } = {}) {
  const sessionId = agent?.session?.id ?? agent?.session?.header?.id ?? agent?.id;
  const resolvedTeamId = stringId(teamId, 'teamId');
  const resolvedMemberId = stringId(memberId, 'memberId');
  return {
    actor: 'agent',
    teamId: resolvedTeamId,
    memberId: resolvedMemberId,
    sessionId: stringId(sessionId, 'sessionId'),
  };
}

export function creatorContext(agent) {
  const sessionId = agent?.session?.id ?? agent?.session?.header?.id ?? agent?.id;
  return { actor: 'agent', sessionId: stringId(sessionId, 'sessionId') };
}

export function systemContext(teamId) {
  return { actor: 'system', teamId: stringId(teamId, 'teamId') };
}

export function serializeError(error) {
  if (error instanceof TeamError) return error.toJSON();
  return { code: 'team/unavailable', message: error?.message ?? 'Team action failed', details: { retryable: true } };
}
