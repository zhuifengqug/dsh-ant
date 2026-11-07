import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';
import { foldTeam } from '../../src/core/fold.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const evidence = [{ kind: 'command', locator: 'node --test', note: 'suite green' }];
const createPayload = {
  goal: 'Ship the skeleton',
  workspaceRelativePath: '.',
  plan: {
    planId: 'plan-1', mode: 'normal', maxActiveAttempts: 2,
    tasks: [
      { taskId: 'task-1', title: 'First', objective: 'First slice', inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'], readOnly: true },
      { taskId: 'task-2', title: 'Second', objective: 'Second slice', inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'] },
    ],
    dependencies: [{ taskId: 'task-2', blockedByTaskId: 'task-1' }],
    qualityGates: [],
  },
  members: [
    { memberId: 'member-1', role: 'engineer', sessionMode: 'persistent', sessionId: 'session-1', provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] },
    { memberId: 'member-2', role: 'reviewer', sessionMode: 'persistent', sessionId: 'session-2', provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] },
  ],
};
const asMember = (teamId, memberId) => ({ actor: 'agent', teamId, memberId, sessionId: `session-${memberId.slice(-1)}` });
const asSystem = teamId => ({ actor: 'system', teamId });

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-skeleton-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const created = await service.dispatch({ requestId: 'create-skeleton', action: 'team.create', payload: createPayload }, user);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: 'confirm-skeleton', teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  return { service, teamId };
}

test('skeleton actions land as events and are visible through the fold', async t => {
  const { service, teamId } = await fixture(t);
  const dispatched = await service.dispatch({ requestId: 'dispatch-1', teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-1', variants: 2 } }, asSystem(teamId));
  assert.equal(dispatched.outcome, 'committed');
  let view = await service.get({ teamId });
  const attempt = view.attempts.at(-1);
  assert.equal(attempt.variant, 1);
  assert.equal(attempt.variants, 2);

  const completed = await service.dispatch({ requestId: 'complete-1', teamId, action: 'task.complete', payload: { taskId: 'task-1', attemptId: attempt.attemptId, summary: 'done', evidence } }, asMember(teamId, 'member-1'));
  assert.equal(completed.outcome, 'committed');
  view = await service.get({ teamId });
  assert.equal(view.tasks[0].selfCompleted, true);
  assert.equal(view.attempts.at(-1).state, 'running');

  await assert.rejects(
    service.dispatch({ requestId: 'review-own', teamId, action: 'quality.review', payload: { taskId: 'task-1', attemptId: attempt.attemptId, reviewerMemberId: 'member-1', verdict: 'pass', criteria: ['tests pass'], summary: 'self review' } }, asMember(teamId, 'member-1')),
    { code: 'team/invalid-state' }
  );

  const reviewed = await service.dispatch({ requestId: 'review-1', teamId, action: 'quality.review', payload: { taskId: 'task-1', attemptId: attempt.attemptId, reviewerMemberId: 'member-2', verdict: 'pass', criteria: ['tests pass'], summary: 'peer review' } }, asMember(teamId, 'member-2'));
  assert.equal(reviewed.outcome, 'committed');
  view = await service.get({ teamId });
  assert.equal(view.tasks[0].state, 'reviewed');
  assert.equal(view.reviews.length, 1);

  await assert.rejects(
    service.dispatch({ requestId: 'release-empty', teamId, action: 'batch.release', payload: { batchId: 'batch-1', taskIds: [] } }, user),
    { code: 'team/invalid-state' }
  );
  const released = await service.dispatch({ requestId: 'release-1', teamId, action: 'batch.release', payload: { batchId: 'batch-1', taskIds: ['task-1'] } }, user);
  assert.equal(released.outcome, 'committed');
  view = await service.get({ teamId });
  assert.equal(view.tasks[0].state, 'released');
  assert.equal(view.batches.length, 1);

  const selected = await service.dispatch({ requestId: 'select-1', teamId, action: 'attempt.select', payload: { taskId: 'task-1', attemptId: attempt.attemptId, variant: 1 } }, user);
  assert.equal(selected.outcome, 'committed');
  view = await service.get({ teamId });
  assert.equal(view.attempts.at(-1).selectedVariant, 1);

  const claim = await service.dispatch({ requestId: 'claim-open', teamId, action: 'task.claim', payload: { taskId: 'task-2', memberId: 'member-2' } }, asMember(teamId, 'member-2'));
  assert.equal(claim.outcome, 'committed');
  await assert.rejects(
    service.dispatch({ requestId: 'release-by-member', teamId, action: 'batch.release', payload: { batchId: 'batch-2', taskIds: ['task-1'] } }, asMember(teamId, 'member-1')),
    { code: 'team/forbidden' }
  );
});

test('run.interrupted is system-only, marks the team and keeps the attempt open', async t => {
  const { service, teamId } = await fixture(t);
  await service.dispatch({ requestId: 'dispatch-2', teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-1' } }, asSystem(teamId));
  await assert.rejects(
    service.dispatch({ requestId: 'interrupt-member', teamId, action: 'run.interrupted', payload: { reason: 'host restart' } }, asMember(teamId, 'member-1')),
    { code: 'team/forbidden' }
  );
  const interrupted = await service.dispatch({ requestId: 'interrupt-1', teamId, action: 'run.interrupted', payload: { reason: 'host restart' } }, asSystem(teamId));
  assert.equal(interrupted.outcome, 'committed');
  const view = await service.get({ teamId });
  assert.equal(view.lifecycle, 'interrupted');
  assert.equal(view.interruptions.length, 1);
  assert.equal(view.attempts.at(-1).state, 'running');
});

test('fold accepts every skeleton event and still refuses unknown types', () => {
  const base = { teamId: 'team-x', eventSeq: 0 };
  const seed = [
    { ...base, eventSeq: 1, type: 'team.created', payload: { ...createPayload, plan: { ...createPayload.plan, tasks: [createPayload.plan.tasks[0]], dependencies: [] } } },
  ];
  const seedView = foldTeam(seed);
  const events = [
    { ...base, eventSeq: 2, type: 'attempt.dispatched', attemptId: 'attempt-x', payload: { taskId: 'task-1', memberId: 'member-1', attemptId: 'attempt-x', generation: 1 } },
    { ...base, eventSeq: 3, type: 'task.completed', attemptId: 'attempt-x', payload: { taskId: 'task-1', attemptId: 'attempt-x', summary: 'done', evidence } },
    { ...base, eventSeq: 4, type: 'quality.reviewed', attemptId: 'attempt-x', payload: { taskId: 'task-1', attemptId: 'attempt-x', reviewerMemberId: 'member-2', verdict: 'pass', criteria: ['ok'], summary: 'pass' } },
    { ...base, eventSeq: 5, type: 'batch.released', payload: { batchId: 'batch-x', taskIds: ['task-1'] } },
    { ...base, eventSeq: 6, type: 'attempt.selected', attemptId: 'attempt-x', payload: { taskId: 'task-1', attemptId: 'attempt-x', variant: 1 } },
    { ...base, eventSeq: 7, type: 'spend.recorded', payload: { attemptId: 'attempt-x', taskId: 'task-1', memberId: 'member-1', inputTokens: 10, outputTokens: 20, requests: 1 } },
    { ...base, eventSeq: 8, type: 'team.drain-complete', payload: {} },
    { ...base, eventSeq: 9, type: 'team.archived', payload: {} },
  ];
  const view = foldTeam([...seed, ...events]);
  assert.equal(view.tasks[0].state, 'released');
  assert.equal(view.attempts[0].selectedVariant, 1);
  assert.equal(view.spend.length, 1);
  assert.equal(view.lifecycle, 'archived');
  assert.equal(seedView.lifecycle, 'staged');
  assert.throws(() => foldTeam([...seed, { ...base, eventSeq: 2, type: 'team.unknown', payload: {} }]), { code: 'team/rebuild-required' });
});
