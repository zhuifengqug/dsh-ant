import { randomUUID } from 'node:crypto';
import { invariant } from './errors.mjs';
import { readyTasks, validatePlan } from './plan.mjs';
import { autonomyPolicy, capacityOf, candidatesAllowed } from './autonomy.mjs';
import { gateStatus } from './gate.mjs';

const userOnly = new Set(['plan.confirm', 'attempt.takeover', 'attempt.terminate', 'member.invite', 'member.remove', 'member.changeModel', 'batch.release', 'attempt.select', 'team.archive', 'team.restore', 'team.delete']);
const scheduled = new Set(['attempt.dispatch', 'attempt.pause', 'attempt.resume', 'attempt.retry', 'attempt.fallback', 'task.claim', 'run.interrupted', 'spend.record', 'member.hatch']);
const systemOnly = new Set(['attempt.dispatch', 'attempt.pause', 'attempt.resume', 'attempt.retry', 'attempt.fallback', 'run.interrupted', 'spend.record', 'member.hatch']);
const active = attempt => ['queued', 'running', 'paused'].includes(attempt.state);
const change = (type, payload, attemptId) => ({ type, payload, ...(attemptId ? { attemptId } : {}) });
const requireState = (condition, message) => invariant(condition, 'team/invalid-state', message);
/** Plan and roster edits are the lead's signature; the owner may always sign. */
function leadReserved(view, context) {
  if (context.actor === 'user') return;
  invariant(view.leadMemberId !== undefined && view.leadMemberId === context.memberId, 'team/forbidden', 'This action is reserved to the colony lead');
}
const planStateOf = view => view.planState ?? (view.planConfirmed ? 'confirmed' : 'staged');

/** verify[] is a promise: every command must appear as a command evidence line before completion. */
function uncoveredVerify(task, evidence) {
  const commands = evidence.filter(item => item.kind === 'command').map(item => String(item.locator ?? '').trim());
  return (task.verify ?? []).filter(command => {
    const needle = String(command).trim();
    return needle.length > 0 && !commands.some(locator => locator === needle || locator.startsWith(needle + ' '));
  });
}

/** Validate trusted caller independently of JSON payload. Host adapters construct this context. */
export function authorize(request, context, view) {
  invariant(context && ['user', 'agent', 'system'].includes(context.actor), 'team/forbidden', 'Trusted caller is required');
  if (context.actor === 'user') {
    invariant(context.principal?.kind === 'owner', 'team/forbidden', 'Owner principal required');
    return;
  }
  invariant(!userOnly.has(request.action), 'team/forbidden', 'Action is user-only');
  if (request.action === 'team.create') {
    invariant(context.actor === 'agent' && typeof context.sessionId === 'string' && context.sessionId.length > 0, 'team/forbidden', 'Team creation from a tool requires an agent Session');
    const roster = request.payload?.members ?? [];
    const lead = request.payload?.leadMemberId;
    if (lead === undefined) {
      const seated = roster.filter(item => item?.sessionId && item.sessionId === context.sessionId);
      invariant(seated.length === 1, 'team/forbidden', 'Team creation must seat the calling Session as exactly one member');
    } else {
      const seat = roster.find(item => item?.memberId === lead);
      invariant(seat, 'team/forbidden', 'Lead member is not in the roster');
      invariant(!seat.sessionId || seat.sessionId === context.sessionId, 'team/forbidden', 'Lead member carries another Session');
      invariant(!roster.some(item => item?.memberId !== lead && item?.sessionId === context.sessionId), 'team/forbidden', 'One Session cannot hold two team identities');
    }
    return;
  }
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
  invariant(['member.accept', 'mail.send', 'mail.read', 'mail.consume', 'quality.report', 'task.claim', 'task.complete', 'quality.review', 'task.create', 'task.amend', 'task.reassign', 'plan.amend', 'team.halt', 'team.resume', 'attempt.fallback'].includes(request.action), 'team/forbidden', 'Action unavailable to member');
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
    const seated = context.actor === 'agent' && context.sessionId && payload.leadMemberId
      ? { ...payload, members: payload.members.map(item => item.memberId === payload.leadMemberId ? { ...item, sessionId: context.sessionId } : item) }
      : payload;
    validatePlan(seated.plan, seated.members);
    return [change('team.created', seated)];
  }
  invariant(view, 'team/not-found', 'Team does not exist', { teamId: request.teamId });
  if (view.lifecycle === 'deleting') requireState(action === 'team.delete', 'Team deletion is in progress');
  else if (view.lifecycle === 'archived') requireState(['team.restore', 'team.delete'].includes(action), 'Team is archived');
  else if (view.lifecycle === 'archiving') requireState(action === 'team.delete', 'Team archival is in progress');
  const task = id => { const item = view.tasks.find(value => value.taskId === id); requireState(item, 'Task not found'); return item; };
  const member = id => { const item = view.members.find(value => value.memberId === id && value.status === 'active'); requireState(item, 'Active member not found'); return item; };
  const attempt = (taskId, attemptId) => {
    const item = view.attempts.find(value => value.attemptId === attemptId && value.taskId === taskId);
    requireState(item, 'Stale attempt generation');
    const siblings = view.attempts.filter(value => value.taskId === taskId);
    requireState(siblings.at(-1) === item || task(taskId).readOnly === true, 'Stale attempt generation');
    return item;
  };
  if (action === 'plan.confirm') {
    requireState(planStateOf(view) !== 'confirmed' && payload.planDigest === view.planDigest, 'Plan digest mismatch or already confirmed');
    return [change('plan.confirmed', payload)];
  }
  if (action === 'plan.amend') {
    leadReserved(view, context);
    requireState(['staged', 'confirmed', 'amended'].includes(planStateOf(view)), 'Plan cannot be amended in its current state');
    const next = new Set(payload.plan.tasks.map(item => item.taskId));
    const dropped = view.tasks.filter(item => !next.has(item.taskId));
    requireState(!dropped.some(item => view.attempts.some(value => value.taskId === item.taskId && active(value))), 'Plan amendment cannot drop a task with active work');
    requireState(!dropped.some(item => ['reviewed', 'released'].includes(item.state)), 'Plan amendment cannot drop a settled task');
    validatePlan(payload.plan, view.members.filter(item => item.status !== 'removed'));
    return [change('plan.amended', { plan: payload.plan, previousDigest: view.planDigest, reason: payload.reason, revision: (view.planRevisions?.length ?? 0) + 1 })];
  }
  if (action === 'task.create') {
    leadReserved(view, context);
    requireState(view.planConfirmed, 'Plan requires confirmation');
    requireState(!view.tasks.some(item => item.taskId === payload.task.taskId), 'Task identity already exists');
    const dependencies = payload.dependencies ?? [];
    const qualityGates = payload.qualityGates ?? [];
    const grown = { ...view.plan, tasks: [...view.plan.tasks, payload.task], dependencies: [...view.plan.dependencies, ...dependencies], qualityGates: [...view.plan.qualityGates, ...qualityGates] };
    validatePlan(grown, view.members.filter(item => item.status !== 'removed'));
    return [change('task.created', { task: payload.task, dependencies, qualityGates, reason: payload.reason, revision: (view.taskRevisions?.length ?? 0) + 1 })];
  }
  if (action === 'task.amend') {
    leadReserved(view, context);
    const selected = task(payload.taskId);
    requireState(selected.state !== 'released', 'Task is already released');
    requireState(Object.keys(payload.patch).length > 0, 'Task amendment is empty');
    if (payload.patch.ownerMemberId !== undefined) member(payload.patch.ownerMemberId);
    const touchesContract = ['title', 'objective', 'inScope', 'outOfScope', 'acceptance', 'verify'].some(key => Object.hasOwn(payload.patch, key));
    const reset = touchesContract && selected.selfCompleted === true;
    const inFlight = view.attempts.some(item => item.taskId === payload.taskId && active(item));
    requireState(!touchesContract || !inFlight || selected.selfCompleted === true, 'Amending the contract requires settling the running attempt');
    const patched = { ...view.plan, tasks: view.plan.tasks.map(item => item.taskId === payload.taskId ? { ...item, ...payload.patch } : item) };
    validatePlan(patched, view.members.filter(item => item.status !== 'removed'));
    return [change('task.amended', { ...payload, reset, revision: (view.taskRevisions?.length ?? 0) + 1 })];
  }
  if (action === 'task.reassign') {
    leadReserved(view, context);
    const selected = task(payload.taskId);
    member(payload.memberId);
    requireState(selected.state !== 'released', 'Task is already released');
    requireState(!view.attempts.some(item => item.taskId === payload.taskId && active(item) && item.memberId !== payload.memberId), 'Reassignment requires settling the running attempt');
    return [change('task.reassigned', { ...payload, revision: (view.taskRevisions?.length ?? 0) + 1 })];
  }
  if (action === 'team.halt' || action === 'team.resume') {
    leadReserved(view, context);
    requireState(action === 'team.halt' ? view.halted !== true : view.halted === true, action === 'team.halt' ? 'Team is already halted' : 'Team is not halted');
    const halting = action === 'team.halt';
    const open = halting ? view.attempts.filter(active) : view.attempts.filter(item => item.state === 'paused');
    const wrapped = open.map(item => change(halting ? 'attempt.pause-requested' : 'attempt.resume-requested', { taskId: item.taskId, attemptId: item.attemptId }, item.attemptId));
    const header = halting
      ? change('team.halted', payload.reason === undefined ? {} : { reason: payload.reason })
      : change('team.resumed', {});
    return [header, ...wrapped];
  }
  if (action === 'attempt.dispatch' || action === 'attempt.retry') {
    requireState(view.planConfirmed, 'Plan requires confirmation');
    requireState(view.halted !== true, 'Team is halted');
    const selected = task(payload.taskId); member(payload.memberId);
    requireState(!view.attempts.some(item => active(item) && item.memberId === payload.memberId), 'Member already has active work');
    requireState(view.attempts.filter(active).length < capacityOf(view, autonomyPolicy(context.settings)), 'Active attempt limit reached');
    if (action === 'attempt.retry') {
      const previous = attempt(payload.taskId, payload.previousAttemptId);
      requireState(['failed', 'terminated'].includes(previous.state), 'Previous attempt is not retryable');
    } else if (payload.variants > 1 && selected.state === 'running') {
      requireState(candidatesAllowed(selected, autonomyPolicy(context.settings)), 'This task may not run candidates in parallel');
    } else requireState(readyTasks(view).some(item => item.taskId === selected.taskId), 'Task is not dependency-ready');
    if (payload.variants > 1) requireState(candidatesAllowed(selected, autonomyPolicy(context.settings)), 'This task may not run candidates in parallel');
    requireState(!selected.ownerMemberId || selected.ownerMemberId === payload.memberId, 'Task ownership conflicts with dispatch');
    const attemptId = `attempt-${randomUUID()}`;
    const generation = view.attempts.filter(item => item.taskId === payload.taskId).length + 1;
    return [change('attempt.dispatched', { taskId: payload.taskId, memberId: payload.memberId, attemptId, generation, ...(payload.variants ? { variants: payload.variants, variant: generation } : {}) }, attemptId)];
  }
  if (action === 'attempt.fallback') {
    requireState(view.planConfirmed, 'Plan requires confirmation');
    requireState(view.halted !== true, 'Team is halted');
    const selected = task(payload.taskId); const executor = member(payload.memberId);
    const previous = attempt(payload.taskId, payload.previousAttemptId);
    requireState(previous.state === 'failed', 'Previous attempt is not retryable');
    requireState(previous.interruption?.kind === 'error', 'Only a failed provider run falls back');
    requireState(executor.fallback !== undefined, 'Member declares no fallback model');
    requireState(executor.fallback.model !== (previous.model ?? executor.model), 'Fallback model repeats the failed one');
    requireState(!view.attempts.some(item => active(item) && item.memberId === payload.memberId), 'Member already has active work');
    requireState(view.attempts.filter(active).length < capacityOf(view, autonomyPolicy(context.settings)), 'Active attempt limit reached');
    requireState(!selected.ownerMemberId || selected.ownerMemberId === payload.memberId, 'Task ownership conflicts with dispatch');
    const attemptId = `attempt-${randomUUID()}`;
    const generation = view.attempts.filter(item => item.taskId === payload.taskId).length + 1;
    const { provider, model, reasoningEffort } = executor.fallback;
    return [change('attempt.dispatched', { taskId: payload.taskId, memberId: payload.memberId, attemptId, generation, provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }), fallbackOf: previous.attemptId }, attemptId)];
  }
  if (['attempt.pause', 'attempt.resume', 'attempt.takeover', 'attempt.terminate'].includes(action)) {
    const selected = attempt(payload.taskId, payload.attemptId);
    const allowed = action === 'attempt.resume' ? selected.state === 'paused' : active(selected);
    requireState(allowed, 'Attempt is not controllable in its current state');
    const types = { 'attempt.pause': 'attempt.pause-requested', 'attempt.resume': 'attempt.resume-requested', 'attempt.takeover': 'attempt.takeover-requested', 'attempt.terminate': 'attempt.terminate-requested' };
    return [change(types[action], payload, payload.attemptId)];
  }
  if (action === 'member.hatch') {
    requireState(view.planConfirmed, 'Plan requires confirmation');
    const target = view.members.find(item => item.memberId === payload.memberId);
    requireState(target, 'Member not found');
    requireState(target.origin === 'team-created' && !target.sessionId, 'Member already holds a Session');
    requireState(!view.members.some(item => item.memberId !== payload.memberId && item.sessionId === payload.sessionId && item.status !== 'removed'), 'Session already belongs to the team');
    return [change('member.hatched', payload)];
  }
  if (action === 'member.invite') {
    requireState(!view.members.some(item => item.sessionId === payload.sessionId && item.status !== 'removed'), 'Session already belongs to the team');
    requireState(!view.invitations.some(item => item.sessionId === payload.sessionId && item.state === 'requested'), 'Invitation already pending');
    let depth;
    if (payload.parentMemberId) {
      requireState(view.plan.memberDelegation === true, 'Members may not spawn subagents');
      requireState(!member(payload.parentMemberId).depth, 'Members may not spawn subagents');
      depth = 1;
    }
    return [change('member.invited', { ...payload, ...(depth ? { depth } : {}), invitationId: `invitation-${randomUUID()}` })];
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
    requireState(!view.attempts.some(item => item.state !== 'terminated'), 'Archive requires every attempt to be terminated');
    requireState(!view.mailbox.some(item => ['queued', 'admitted'].includes(item.state)), 'Archive requires the mailbox to drain');
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
    requireState(view.halted !== true, 'Team is halted');
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
    const uncovered = uncoveredVerify(task(payload.taskId), payload.evidence);
    requireState(uncovered.length === 0, 'Completion is missing verify evidence: ' + uncovered.join(' | '));
    return [change('task.completed', payload, payload.attemptId)];
  }
  if (action === 'quality.review') {
    const selected = attempt(payload.taskId, payload.attemptId);
    requireState(['running', 'reviewed'].includes(selected.state), 'Review requires the current admitted attempt');
    requireState(task(payload.taskId).selfCompleted === true, 'Review requires the executor self-completion');
    const named = payload.gateId === undefined ? undefined : (view.plan?.qualityGates ?? []).find(item => item.gateId === payload.gateId);
    // Integration is the one verdict a released task can still receive: it records shipping, not work.
    const integrating = named?.kind === 'integration' && named.taskId === payload.taskId && task(payload.taskId).state === 'released';
    requireState(integrating || !['released', 'archived'].includes(task(payload.taskId).state), 'Review is closed for a released task');
    member(payload.reviewerMemberId);
    requireState(!view.attempts.some(item => item.taskId === payload.taskId && item.memberId === payload.reviewerMemberId), 'Reviewer must not be a claimant of the task');
    requireState(payload.criteria.length > 0, 'Review requires explicit criteria');
    const declared = (view.plan?.qualityGates ?? []).filter(item => item.taskId === payload.taskId && item.kind === 'review');
    requireState(declared.length <= 1 || payload.gateId !== undefined, 'Review must name its gate when the task declares several');
    if (payload.gateId !== undefined) {
      requireState(named !== undefined && named.taskId === payload.taskId && named.kind === (integrating ? 'integration' : 'review'), 'Review gate does not belong to this task');
    }
    return [change('quality.reviewed', payload, payload.attemptId)];
  }
  if (action === 'batch.release') {
    requireState(payload.taskIds.length > 0, 'Batch release requires at least one task');
    const policy = autonomyPolicy(context.settings);
    requireState(!policy.releaseCap || payload.taskIds.length <= policy.releaseCap, `${policy.autonomy} releases one task at a time`);
    for (const taskId of payload.taskIds) {
      requireState(task(taskId).state === 'reviewed', 'Task is not awaiting release');
      const blocking = gateStatus(view, view.plan, taskId).gates.filter(gate => !gate.satisfied && gate.kind !== 'integration').map(gate => gate.gateId);
      requireState(blocking.length === 0, 'Release is blocked by open gates: ' + blocking.join(' | '));
    }
    return [change('batch.released', payload)];
  }
  if (action === 'attempt.select') {
    const selected = attempt(payload.taskId, payload.attemptId);
    requireState(Number.isSafeInteger(selected.variant), 'Attempt has no candidate variant to select');
    requireState(selected.variant === payload.variant, 'Selected variant does not match the attempt');
    const discarded = view.attempts.filter(item => item.taskId === payload.taskId && item.attemptId !== payload.attemptId && active(item));
    return [change('attempt.selected', payload, payload.attemptId), ...discarded.map(item => change('attempt.terminate-requested', { taskId: payload.taskId, attemptId: item.attemptId }, item.attemptId))];
  }
  if (action === 'spend.record') {
    const selected = attempt(payload.taskId, payload.attemptId);
    requireState(!active(selected), 'Spend is recorded once the attempt is settled');
    requireState(!view.spend.some(item => item.attemptId === payload.attemptId), 'Spend is already recorded for this attempt');
    const known = Number.isSafeInteger(payload.tokensIn) && Number.isSafeInteger(payload.tokensOut);
    return [change('spend.recorded', { ...payload, memberId: selected.memberId, known, ...(known ? {} : { tokensIn: null, tokensOut: null, costMicros: null }) }, payload.attemptId)];
  }
  if (action === 'run.interrupted') {
    requireState(view.attempts.some(active), 'No open attempt to interrupt');
    if (payload.attemptId !== undefined) {
      requireState(payload.taskId !== undefined, 'attemptId requires taskId');
      requireState(active(attempt(payload.taskId, payload.attemptId)), 'Attempt is not active');
    }
    return [change('run.interrupted', payload)];
  }
  requireState(false, 'Action has no decision handler');
}
