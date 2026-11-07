/** Cost is read-only reporting: nothing here feeds back into dispatch. */
const blank = () => ({ attempts: 0, known: 0, unknown: 0, tokensIn: 0, tokensOut: 0, costMicros: 0 });

function tally(bucket, entry) {
  bucket.attempts += 1;
  if (entry.known) {
    bucket.known += 1;
    bucket.tokensIn += entry.tokensIn ?? 0;
    bucket.tokensOut += entry.tokensOut ?? 0;
    bucket.costMicros += entry.costMicros ?? 0;
  } else bucket.unknown += 1;
  return bucket;
}

const group = (entries, keyOf) => entries.reduce((acc, entry) => {
  const key = keyOf(entry) ?? 'unknown';
  acc[key] = tally(acc[key] ?? blank(), entry);
  return acc;
}, {});

export function summarizeSpend(view) {
  const rows = view.spend;
  const total = rows.reduce((acc, entry) => tally(acc, entry), blank());
  return {
    ...total,
    attempts: rows.length,
    byMember: group(rows, entry => entry.memberId),
    byTask: group(rows, entry => entry.taskId),
    byAttempt: group(rows, entry => entry.attemptId),
    rows: rows.map(entry => ({ attemptId: entry.attemptId, taskId: entry.taskId, memberId: entry.memberId, variant: entry.variant ?? null, known: entry.known, tokensIn: entry.tokensIn, tokensOut: entry.tokensOut, costMicros: entry.costMicros, model: entry.model ?? null, source: entry.source ?? null, eventSeq: entry.eventSeq })),
  };
}

/** One settlement call records cost exactly once: the attempt ends, then its usage lands. */
export async function settleWithSpend({ service, teamId, taskId, attemptId, usage, context = { actor: 'user', principal: { kind: 'owner' } } }) {
  await service.dispatch({ requestId: `settle-${attemptId}`, teamId, action: 'attempt.terminate', payload: { taskId, attemptId } }, context);
  const payload = { taskId, attemptId, ...(usage ?? { source: 'host-missing' }) };
  return service.dispatch({ requestId: `spend-${attemptId}`, teamId, action: 'spend.record', payload }, { actor: 'system', teamId });
}
