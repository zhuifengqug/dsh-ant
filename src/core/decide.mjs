import { randomUUID } from 'node:crypto';
import { invariant } from './errors.mjs';
import { readyTasks, validatePlan } from './plan.mjs';

const userOnly = new Set(['team.create', 'plan.confirm', 'attempt.takeover', 'attempt.terminate', 'member.invite', 'member.remove', 'member.changeModel', 'batch.release', 'attempt.select', 'team.archive', 'team.restore', 'team.delete']);
const scheduled = new Set(['attempt.dispatch', 'attempt.pause', 'attempt.resume', 'attempt.retry', 'task.claim', 'run.interrupted']);
const systemOnly = new Set(['attempt.dispatch', 'attempt.pause', 'attempt.resume', 'attempt.retry', 'run.interrupted']);
const active = attempt => ['queued', 'running', 'paused'].includes(attempt.state);
const change = (type, payload, attemptId) => ({ type, payload, ...(attemptId ? { attemptId } : {}) });
const requireState = (condition, message) => invariant(condition, 'team/invalid-state', message);

/** Validate trusted caller independently of JSON payload. Host adapters construct this context. */
export function authorize(request, context, view) {
  invariant(context && ['user', 'agent', 'system'].includes(context.actor), 'team/forbidden', 'Trusted caller is required');
  if (context.actor === 'user') {
    invariant(context.principal?.kind === 'owner', 'team/forbidden', 'Owner principal required');
    return;
  }
  invariant(!userOnly.has(request.action), 'team/forbidden', 'Action is user-only');
  if (context.actor === 'system') {
    invariant(context.teamId === request.teamId && view?.planConfirmed && scheduled.has(request.action), 'team/forbidden', 'Scheduler authority is limited to a confirmed team');
    return;
  }
  invariant(!systemOnly.has(request.action) && context.teamId === request.teamId, 'team/forbidden', 'Member action outside team');
  const member = view?.members.find(item => item.memberId === context.memberId && item.status === 'active');
  invariant(member && member.sessionId === context.sessionId, 'team/forbidden', 'Active member Session binding required');
  if (['mail.read', 'mail.consume'].includes(request.action)) {
    const mail = view.mailbox.find(item => item.messageId === request.payload.messageId);
    invariant(mail?.toMemberId === member.memberId, 'team/forbidden', 'Receipt is restricted to the recipient');
  }
  if (request.action === 'quality.report') {
    const attempt = view.attempts.find(item => item.attemptId === request.payload.attemptId);
    invariant(attempt?.memberId === member.memberId, 'team/forbidden', 'Quality report is restricted to the assigned attempt');
  }
  invariant(['member.accept', 'mail.send', 'mail.read', 'mail.consume', 'quality.report', 'task.claim', 'task.complete', 'quality.review'].includes(request.action), 'team/forbidden', 'Action unavailable to member');
  if (request.action === 'task.claim') invariant(request.payload.memberId === member.memberId, 'team/forbidden', 'Claim must name the calling member');
  if (request.action === 'task.complete') { const target = view.attempts.find(item => item.attemptId === request.payload.attemptId); invariant(target?.memberId === member.memberId, 'team/forbidden', 'Completion is restricted to the assigned attempt'); }
  if (request.action === 'quality.review') invariant(request.payload.reviewerMemberId === member.memberId, 'team/forbidden', 'Review must name the calling member');
}

/** Produce durable intent/fact events only. Admission and side effects are separate events. */
export function decideAction(view, request, context) {
  const { action, payload } = request;
  authorize(request, context, view);
  if (action === 'team.create') {
    requireState(!view, 'Team already exists');
    validatePlan(payload.plan, payload.members);
    return [change('team.created', payload)];
  }
  invariant(view, 'team/not-found', 'Team does not exist', { teamId: request.teamId });
  if (view.lifecycle === 'deleting') requireState(action === 'team.delete', 'Team deletion is in progress');
  else if (view.lifecycle === 'archived') requireState(['team.restore', 'team.delete'].includes(action), 'Team is archived');
  else if (view.lifecycle === 'archiving') requireState(action === 'team.delete', 'Team archival is in progress');
  const task = id => { const item = view.tasks.find(value => value.taskId === id); requireState(item, 'Task not found'); return item; };
  const member = id => { const item = view.members.find(value => value.memberId === id && value.status === 'active'); requireState(item, 'Active member not found'); return item; };
  const attempt = (taskId, attemptId) => {
    const item = view.attempts.find(value => value.attemptId === attemptId && value.taskId === taskId);
    requireState(item && view.attempts.filter(value => value.taskId === taskId).at(-1) === item, 'Stale attempt generation');
    return item;
  };
  if (action === 'plan.confirm') {
    requireState(!view.planConfirmed && payload.planDigest === view.planDigest, 'Plan digest mismatch or already confirmed');
    return [change('plan.confirmed', payload)];
  }
  if (action === 'attempt.dispatch' || action === 'attempt.retry') {
    requireState(view.planConfirmed, 'Plan requires confirmation');
    const selected = task(payload.taskId); member(payload.memberId);
    requireState(!view.attempts.some(item => active(item) && item.memberId === payload.memberId), 'Member already has active work');
    requireState(view.attempts.filter(active).length < view.plan.maxActiveAttempts, 'Active attempt limit reached');
    if (action === 'attempt.retry') {
      const previous = attempt(payload.taskId, payload.previousAttemptId);
      requireState(['failed', 'terminated'].includes(previous.state), 'Previous attempt is not retryable');
    } else requireState(readyTasks(view).some(item => item.taskId === selected.taskId), 'Task is not dependency-ready');
    requireState(!selected.ownerMemberId || selected.ownerMemberId === payload.memberId, 'Task ownership conflicts with dispatch');
    const attemptId = `attempt-${randomUUID()}`;
    return [change('attempt.dispatched', { taskId: payload.taskId, memberId: payload.memberId, attemptId, generation: view.attempts.filter(item => item.taskId === payload.taskId).length + 1, ...(payload.variants ? { variants: payload.variants, variant: 1 } : {}) }, attemptId)];
  }
  if (['attempt.pause', 'attempt.resume', 'attempt.takeover', 'attempt.terminate'].includes(action)) {
    const selected = attempt(payload.taskId, payload.attemptId);
    const allowed = action === 'attempt.resume' ? selected.state === 'paused' : active(selected);
    requireState(allowed, 'Attempt is not controllable in its current state');
    const types = { 'attempt.pause': 'attempt.pause-requested', 'attempt.resume': 'attempt.resume-requested', 'attempt.takeover': 'attempt.takeover-requested', 'attempt.terminate': 'attempt.terminate-requested' };
    return [change(types[action], payload, payload.attemptId)];
  }
  if (action === 'member.invite') {
    requireState(!view.members.some(item => item.sessionId === payload.sessionId && item.status !== 'removed'), 'Session already belongs to the team');
    requireState(!view.invitations.some(item => item.sessionId === payload.sessionId && item.state === 'requested'), 'Invitation already pending');
    return [change('member.invited', { ...payload, invitationId: `invitation-${randomUUID()}` })];
  }
  if (action === 'member.accept') {
    const invitation = view.invitations.find(item => item.invitationId === payload.invitationId && item.state === 'requested');
    requireState(invitation, 'Pending invitation not found');
    invariant(context.actor === 'user' || invitation.sessionId === context.sessionId, 'team/forbidden', 'Only invited Session may accept');
    return [change('member.accept-requested', payload)];
  }
  if (action === 'member.remove') {
    member(payload.memberId);
    requireState(!view.attempts.some(item => item.memberId === payload.memberId && active(item)), 'Drain member attempt before removal');
    return [change('member.removed', payload)];
  }
  if (action === 'member.changeModel') {
    member(payload.memberId);
    return [change('member.model-change-requested', payload)];
  }
  if (action === 'mail.send') {
    const recipient = member(payload.toMemberId);
    requireState(typeof recipient.sessionId === 'string' && recipient.sessionId.length > 0, 'Recipient has no bound Session');
    requireState(!view.mailbox.some(item => item.messageId === payload.messageId), 'Mailbox identity already exists');
    if (payload.taskId) task(payload.taskId);
    if (payload.attemptId) {
      requireState(payload.taskId, 'attemptId requires taskId');
      requireState(active(attempt(payload.taskId, payload.attemptId)), 'Attempt is not active');
    }
    return [change('mail.queued', { ...payload, toSessionId: recipient.sessionId, fromMemberId: context.memberId ?? 'owner' }, payload.attemptId)];
  }
  if (action === 'mail.read' || action === 'mail.consume') {
    const mail = view.mailbox.find(item => item.messageId === payload.messageId);
    requireState(mail, 'Mailbox message does not exist');
    requireState(action === 'mail.read' ? ['admitted', 'delivered'].includes(mail.state) : mail.state === 'read', 'Mailbox receipt is out of order');
    return [change(action, payload, mail.attemptId)];
  }
  if (action === 'quality.report') {
    const selected = attempt(payload.taskId, payload.attemptId);
    requireState(selected.state === 'running', 'Quality requires the current admitted attempt');
    requireState(payload.evidence.length > 0, 'Quality report requires evidence');
    return [change('quality.reported', payload, payload.attemptId)];
  }
  if (action === 'team.archive') {
    requireState(!['archived', 'archiving', 'deleting'].includes(view.lifecycle), 'Invalid archive state');
    return [change('team.archiving', { previousLifecycle: view.lifecycle })];
  }
  if (action === 'team.restore') {
    requireState(view.lifecycle === 'archived', 'Team is not archived');
    return [change('team.restored', { previousLifecycle: view.archivePreviousLifecycle ?? 'planned' })];
  }
  if (action === 'team.delete') {
    requireState(view.lifecycle !== 'deleting', 'Deletion intent already exists; resume cleanup');
    return [change('team.delete-requested', { memberSessions: view.members.filter(item => item.origin === 'team-created' && item.sessionId).map(item => item.sessionId) })];
  }
  if (action === 'task.claim') {
    requireState(view.planConfirmed, 'Plan requires confirmation');
    const selected = task(payload.taskId); member(payload.memberId);
    requireState(!['completed', 'reviewed', 'released'].includes(selected.state), 'Task is already resolved');
    requireState(!selected.claimMemberId, 'Task is already claimed');
    requireState(!view.attempts.some(item => item.taskId === payload.taskId && active(item)), 'Task already has active work');
    requireState(readyTasks(view).some(item => item.taskId === selected.taskId), 'Task is not dependency-ready');
    return [change('task.claimed', payload)];
  }
  if (action === 'task.complete') {
    const selected = attempt(payload.taskId, payload.attemptId);
    requireState(selected.state === 'running', 'Completion requires the current admitted attempt');
    requireState(payload.evidence.length > 0, 'Completion requires evidence');
    return [change('task.completed', payload, payload.attemptId)];
  }
  if (action === 'quality.review') {
    const selected = attempt(payload.taskId, payload.attemptId);
    requireState(selected.state === 'running', 'Review requires the current admitted attempt');
    member(payload.reviewerMemberId);
    requireState(!view.attempts.some(item => item.taskId === payload.taskId && item.memberId === payload.reviewerMemberId), 'Reviewer must not be a claimant of the task');
    requireState(payload.criteria.length > 0, 'Review requires explicit criteria');
    return [change('quality.reviewed', payload, payload.attemptId)];
  }
  if (action === 'batch.release') {
    requireState(payload.taskIds.length > 0, 'Batch release requires at least one task');
    for (const taskId of payload.taskIds) requireState(task(taskId).state === 'reviewed', 'Task is not awaiting release');
    return [change('batch.released', payload)];
  }
  if (action === 'attempt.select') {
    const selected = attempt(payload.taskId, payload.attemptId);
    requireState(Number.isSafeInteger(selected.variant), 'Attempt has no candidate variant to select');
    requireState(selected.variant === payload.variant, 'Selected variant does not match the attempt');
    return [change('attempt.selected', payload, payload.attemptId)];
  }
  if (action === 'run.interrupted') {
    requireState(view.attempts.some(active), 'No open attempt to interrupt');
    return [change('run.interrupted', payload)];
  }
  requireState(false, 'Action has no decision handler');
}
