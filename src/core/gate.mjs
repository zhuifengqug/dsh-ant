/** Two-proof gate: the executor self-reports, an independent member reviews. */
const isActive = member => member.status === 'active' && Boolean(member.sessionId);

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

export function openReviews(view) {
  return view.tasks.filter(task => task.selfCompleted === true && !['reviewed', 'released', 'anomalous'].includes(task.state)).map(task => ({ taskId: task.taskId, repairRounds: task.repairRounds ?? 0, ...reviewAssignment(view, task.taskId) }));
}

/** Tasks that passed the gate and wait for one human release. */
export function pendingRelease(view) {
  return view.tasks.filter(task => task.state === 'reviewed').map(task => ({ taskId: task.taskId, title: task.title, repairRounds: task.repairRounds ?? 0 }));
}
