/** Autonomy levels and the settings that tune them; one policy per action, read fresh. */

const LEVELS = new Set(['L1', 'L2', 'L3']);

export const SETTING_LIMITS = Object.freeze({
  batchWindowMinutes: Object.freeze([1, 240]),
  maxActiveAttempts: Object.freeze([1, 8]),
  defaultVariants: Object.freeze([1, 3]),
});

/**
 * Normalise one settings object into a policy. Unknown levels fall back to L2,
 * because a batch release that silently became full-auto would be a safety bug.
 */
export function autonomyPolicy(settings = {}) {
  const autonomy = LEVELS.has(settings?.autonomy) ? settings.autonomy : 'L2';
  return {
    autonomy,
    autoRelease: autonomy === 'L3',
    releaseCap: autonomy === 'L1' ? 1 : undefined,
    maxActiveAttempts: settings?.maxActiveAttempts ?? 8,
    defaultVariants: settings?.defaultVariants ?? 1,
    variantWriteTasks: settings?.variantWriteTasks === true,
    batchWindowMs: (settings?.batchWindowMinutes ?? 30) * 60000,
  };
}

/** The plan may ask for less parallel work than the deployment allows, never more. */
export function capacityOf(view, policy) {
  return Math.min(view.plan?.maxActiveAttempts ?? 1, policy.maxActiveAttempts);
}

/** Candidates only make sense where the task tolerated it, unless the deployment opted in. */
export function candidatesAllowed(task, policy) {
  return task?.readOnly === true || policy.variantWriteTasks === true;
}

export function variantsFor(task, policy) {
  if (!(policy.defaultVariants > 1)) return 1;
  return candidatesAllowed(task, policy) ? policy.defaultVariants : 1;
}

/** Reviewed tasks whose batch window has closed: the scheduler's only reason to auto-release. */
export function releaseDue(view, { policy, now }) {
  const cutoff = now - policy.batchWindowMs;
  const reviewed = new Map();
  for (const review of view.reviews ?? []) {
    if (review.verdict !== 'pass' || typeof review.occurredAt !== 'number') continue;
    const previous = reviewed.get(review.taskId);
    if (previous === undefined || review.occurredAt > previous) reviewed.set(review.taskId, review.occurredAt);
  }
  return (view.tasks ?? [])
    .filter(task => task.state === 'reviewed' && reviewed.get(task.taskId) !== undefined && reviewed.get(task.taskId) <= cutoff)
    .map(task => task.taskId);
}
