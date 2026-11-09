const UNREAD_STATES = new Set(['queued', 'admitted']);
const OPEN_ATTEMPT_STATES = new Set(['queued', 'running', 'paused']);

function mailDigest(item) {
  return {
    messageId: item.messageId,
    toMemberId: item.toMemberId,
    fromMemberId: item.fromMemberId ?? null,
    state: item.state,
    excerpt: typeof item.content === 'string' ? item.content.slice(0, 160) : '',
  };
}

/**
 * The lead's answer to "where is the colony now": one folded object the panel, the card and the
 * delivery brief can all read, instead of each surface recounting attempts and mailboxes itself.
 */
export function teamSummary(view, coverage) {
  const mailbox = view.mailbox ?? [];
  const unread = mailbox.filter(item => UNREAD_STATES.has(item.state));
  const lastBatch = (view.batches ?? []).at(-1);
  return {
    goal: view.goal,
    lifecycle: view.lifecycle,
    planState: view.planState ?? (view.planConfirmed === true ? 'confirmed' : 'staged'),
    halted: view.halted === true,
    counts: coverage.counts,
    released: (view.tasks ?? []).filter(item => item.state === 'released').map(item => item.taskId),
    open: (view.attempts ?? []).filter(item => OPEN_ATTEMPT_STATES.has(item.state)).map(item => ({
      attemptId: item.attemptId,
      taskId: item.taskId,
      memberId: item.memberId,
      state: item.state,
    })),
    lastBatch: lastBatch === undefined ? null : { batchId: lastBatch.batchId, eventSeq: lastBatch.eventSeq, taskIds: [...lastBatch.taskIds] },
    unread: {
      total: unread.length,
      toLead: view.leadMemberId === undefined ? 0 : unread.filter(item => item.toMemberId === view.leadMemberId).length,
      recent: unread.slice(-5).map(mailDigest),
    },
    repairs: (view.tasks ?? []).filter(item => item.state === 'anomalous').map(item => item.taskId),
    interruption: (view.interruptions ?? []).at(-1) ?? null,
  };
}
