/** Five-gate supervision: the executor self-reports, a peer reviews, the plan's gates decide release. */
const isActive = member => member.status === 'active' && Boolean(member.sessionId);
const RESOLVED = ['reviewed', 'released', 'anomalous'];

export function reviewAssignment(view, taskId) {
  const task = view.tasks.find(item => item.taskId === taskId);
  if (!task) return { intervention: true, reason: 'Task is unknown' };
  if (task.state === 'anomalous') return { intervention: true, reason: 'Task is already in exception' };
  if (task.selfCompleted !== true) return { intervention: true, reason: 'Executor self-completion is still missing' };
  const executors = new Set(view.attempts.filter(item => item.taskId === taskId).map(item => item.memberId));
  const candidates = view.members.filter(item => isActive(item) && !executors.has(item.memberId));
  if (!candidates.length) return { intervention: true, reason: 'No independent reviewer is available' };
  const attempt = [...view.attempts].reverse().find(item => item.taskId === taskId);
  return { reviewerMemberId: candidates[0].memberId, taskId, attemptId: attempt?.attemptId };
}

/**
 * One task's declared gates, judged only by recorded facts.
 * A verification gate is settled by self-completion, because the Host refuses a
 * completion whose evidence does not cover every verify command; a review gate
 * needs a pass review, which must name the gate whenever the task declares more than one.
 */
export function gateStatus(view, plan, taskId) {
  const task = view.tasks.find(item => item.taskId === taskId);
  const passes = (view.reviews ?? []).filter(review => review.taskId === taskId && review.verdict === 'pass');
  const declared = (plan?.qualityGates ?? []).filter(gate => gate.taskId === taskId);
  const single = declared.filter(gate => gate.kind === 'review').length === 1;
  const gates = declared
    .map(gate => ({
      gateId: gate.gateId,
      kind: gate.kind,
      satisfied: gate.kind === 'verification'
        ? task?.selfCompleted === true
        : passes.some(review => (review.gateId ? review.gateId === gate.gateId : single && gate.kind === 'review')),
    }));
  return { gates, pending: gates.filter(gate => !gate.satisfied).map(gate => gate.gateId) };
}

/** Tasks waiting for an independent review, with the gates still open when the plan declares any. */
export function openReviews(view, plan) {
  return view.tasks
    .filter(task => task.selfCompleted === true && !RESOLVED.includes(task.state))
    .map(task => ({ taskId: task.taskId, repairRounds: task.repairRounds ?? 0, ...(plan ? { pendingGates: gateStatus(view, plan, task.taskId).pending } : {}), ...reviewAssignment(view, task.taskId) }));
}

/** Tasks that passed every gate except integration and wait for one human release. */
export function pendingRelease(view, plan) {
  return view.tasks
    .filter(task => task.state === 'reviewed')
    .filter(task => gateStatus(view, plan, task.taskId).gates.every(gate => gate.satisfied || gate.kind === 'integration'))
    .map(task => ({ taskId: task.taskId, title: task.title, repairRounds: task.repairRounds ?? 0 }));
}

/** Reviewed tasks a declared gate still holds back: the panel shows these instead of a silent queue. */
export function blockedRelease(view, plan) {
  return view.tasks
    .filter(task => task.state === 'reviewed')
    .map(task => ({ taskId: task.taskId, pendingGates: gateStatus(view, plan, task.taskId).gates.filter(gate => !gate.satisfied && gate.kind !== 'integration').map(gate => gate.gateId) }))
    .filter(item => item.pendingGates.length > 0);
}

/** Released work whose integration gate has not been recorded yet, checked before archiving. */
export function openIntegration(view, plan) {
  return view.tasks
    .filter(task => task.state === 'released')
    .map(task => ({ taskId: task.taskId, pendingGates: gateStatus(view, plan, task.taskId).gates.filter(gate => !gate.satisfied && gate.kind === 'integration').map(gate => gate.gateId) }))
    .filter(item => item.pendingGates.length > 0);
}

const OPEN_ATTEMPT = new Set(['queued', 'running', 'paused']);

/**
 * Coverage answers one question per task: who holds it, whether that holder can be woken,
 * and which declared gate still stands open. Counts are derived once so no client re-derives them.
 */
export function taskCoverage(view, plan) {
  const bound = memberId => {
    const member = view.members.find(item => item.memberId === memberId);
    return member?.status === 'active' && Boolean(member.sessionId);
  };
  const tasks = view.tasks.map(task => {
    const attempts = view.attempts.filter(item => item.taskId === task.taskId);
    return {
      taskId: task.taskId,
      state: task.state,
      ownerMemberId: task.ownerMemberId ?? null,
      ownerBound: task.ownerMemberId ? bound(task.ownerMemberId) : false,
      attempts: attempts.length,
      openAttempts: attempts.filter(item => OPEN_ATTEMPT.has(item.state)).length,
      selfCompleted: task.selfCompleted === true,
      repairRounds: task.repairRounds ?? 0,
      pendingGates: plan ? gateStatus(view, plan, task.taskId).pending : [],
    };
  });
  const count = state => tasks.filter(item => item.state === state).length;
  return {
    tasks,
    counts: {
      total: tasks.length, pending: count('pending'), running: count('running'), reviewed: count('reviewed'),
      released: count('released'), failed: count('failed'), anomalous: count('anomalous'), dropped: count('dropped'),
      unowned: tasks.filter(item => !item.ownerMemberId).length,
      unbound: tasks.filter(item => Boolean(item.ownerMemberId) && !item.ownerBound).length,
      halted: view.halted === true,
    },
  };
}

/** The panel's queues, derived once so the client never re-implements a gate rule. */
export function withGateQueues(view) {
  return { ...view, releaseQueue: pendingRelease(view, view.plan), blockedRelease: blockedRelease(view, view.plan), integrationQueue: openIntegration(view, view.plan), coverage: taskCoverage(view, view.plan) };
}
