/** Pure readiness evaluation: the scheduler decides, the WAL commits. */
import { resolvedTask } from './plan.mjs';

const ACTIVE_ATTEMPT = new Set(['queued', 'running', 'paused']);

export function evaluateSchedule(view) {
  const capacity = view.plan?.maxActiveAttempts ?? 1;
  const dependencies = view.plan?.dependencies ?? [];
  const open = view.attempts.filter(item => ACTIVE_ATTEMPT.has(item.state));
  const slots = Math.max(0, capacity - open.length);
  const ready = view.tasks.filter(task => task.state === 'pending' && !task.claimMemberId
    && dependencies.every(edge => edge.taskId !== task.taskId || resolvedTask(view.tasks.find(item => item.taskId === edge.blockedByTaskId))));
  const held = new Map(open.map(item => [item.memberId, item]));
  const idle = view.members.filter(member => member.status === 'active' && member.sessionId && !held.has(member.memberId));
  const wake = view.members.filter(member => member.status === 'active' && member.sessionId
    && ['paused', 'taken-over'].includes(held.get(member.memberId)?.state));
  const assigns = [];
  for (const task of ready) {
    if (assigns.length >= slots) break;
    const member = idle[assigns.length];
    if (!member) break;
    assigns.push({ taskId: task.taskId, memberId: member.memberId });
  }
  return {
    capacity, slots,
    ready: ready.map(task => task.taskId),
    assigns,
    wake: wake.map(member => member.memberId),
    queued: ready.slice(assigns.length).map(task => task.taskId),
  };
}

const owner = { actor: 'user', principal: { kind: 'owner' } };

/** Release one batch as the owner, then dispatch whatever the release unblocked. */
export async function releaseBatch({ service, teamId, taskIds, context = owner }) {
  const view = await service.get({ teamId });
  const batchId = `batch-${view.cursor + 1}`;
  const receipt = await service.dispatch({ requestId: `release-${teamId}-${view.cursor + 1}`, teamId, action: 'batch.release', payload: { batchId, taskIds }, }, context);
  const tick = await runSchedule({ service, teamId });
  return { batchId, receipt, tick };
}

/** One tick: wake stalled members, then start every ready task that has a free member and a slot. */
export async function runSchedule({ service, teamId }) {
  const view = await service.get({ teamId });
  const plan = evaluateSchedule(view);
  const dispatched = [];
  let cursor = view.cursor;
  for (const assign of plan.assigns) {
    const receipt = await service.dispatch({ requestId: `schedule-${teamId}-${cursor + 1}`, teamId, action: 'attempt.dispatch', payload: assign }, { actor: 'system', teamId });
    cursor = receipt.lastEventSeq;
    dispatched.push({ taskId: assign.taskId, memberId: assign.memberId, requestId: receipt.requestId, firstEventSeq: receipt.firstEventSeq });
  }
  return { ...plan, dispatched };
}
