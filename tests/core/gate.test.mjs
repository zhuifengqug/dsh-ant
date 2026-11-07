import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';
import { openReviews, reviewAssignment } from '../../src/core/gate.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const member = (id, sessionId) => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] });
const asMember = (teamId, memberId, sessionId) => ({ actor: 'agent', teamId, memberId, sessionId });
const evidence = [{ kind: 'command', locator: 'node --test', note: 'green' }];
const payload = members => ({
  goal: 'Gate the work',
  workspaceRelativePath: '.',
  plan: { planId: 'plan-1', mode: 'normal', maxActiveAttempts: 8, tasks: [{ taskId: 'task-1', title: 'Only', objective: 'Only', inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'] }], dependencies: [], qualityGates: [] },
  members,
});
const reviewer = { taskId: 'task-1', reviewerMemberId: 'member-2', verdict: 'pass', criteria: ['tests pass'], summary: 'peer review' };

async function fixture(t, tag, members) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-gate-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const created = await service.dispatch({ requestId: `create-${tag}`, action: 'team.create', payload: payload(members) }, user);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: `confirm-${tag}`, teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  await service.dispatch({ requestId: `dispatch-${tag}`, teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-1' } }, { actor: 'system', teamId });
  return { service, teamId };
}

const selfProof = async (service, teamId, attemptId, requestId = 'complete-1') => {
  const view = await service.get({ teamId });
  const compiled = attemptId ?? view.attempts.at(-1).attemptId;
  await service.dispatch({ requestId, teamId, action: 'task.complete', payload: { taskId: 'task-1', attemptId: compiled, summary: 'done', evidence } }, asMember(teamId, 'member-1', 'session-1'));
  return compiled;
};

test('a self-report alone never closes the task', async t => {
  const { service, teamId } = await fixture(t, 'self', [member('member-1', 'session-1'), member('member-2', 'session-2')]);
  await selfProof(service, teamId);
  const view = await service.get({ teamId });
  assert.equal(view.tasks[0].selfCompleted, true);
  assert.equal(view.tasks[0].state, 'running');
  assert.deepEqual(openReviews(view).map(item => item.taskId), ['task-1']);

  await service.dispatch({ requestId: 'review-1', teamId, action: 'quality.review', payload: { taskId: 'task-1', attemptId: view.attempts.at(-1).attemptId, ...reviewer } }, asMember(teamId, 'member-2', 'session-2'));
  const gated = await service.get({ teamId });
  assert.equal(gated.tasks[0].state, 'reviewed');
  assert.equal(gated.attempts.at(-1).state, 'reviewed');
});

test('the executor cannot review its own attempt', async t => {
  const { service, teamId } = await fixture(t, 'executor', [member('member-1', 'session-1'), member('member-2', 'session-2')]);
  const attemptId = await selfProof(service, teamId);
  await assert.rejects(
    service.dispatch({ requestId: 'review-self', teamId, action: 'quality.review', payload: { taskId: 'task-1', attemptId, ...reviewer, reviewerMemberId: 'member-1' } }, asMember(teamId, 'member-1', 'session-1')),
    error => error.code === 'team/invalid-state' && /Reviewer/.test(error.message),
  );
});

test('two failed reviews move the task into exception while every attempt survives', async t => {
  const { service, teamId } = await fixture(t, 'anomaly', [member('member-1', 'session-1'), member('member-2', 'session-2')]);
  let attemptId = await selfProof(service, teamId);
  await service.dispatch({ requestId: 'review-fail-1', teamId, action: 'quality.review', payload: { taskId: 'task-1', attemptId, ...reviewer, verdict: 'fail' } }, asMember(teamId, 'member-2', 'session-2'));
  let view = await service.get({ teamId });
  assert.equal(view.tasks[0].state, 'failed');
  assert.equal(view.tasks[0].repairRounds, 1);

  const retried = await service.dispatch({ requestId: 'retry-1', teamId, action: 'attempt.retry', payload: { taskId: 'task-1', memberId: 'member-1', previousAttemptId: attemptId } }, { actor: 'system', teamId });
  assert.equal(retried.outcome, 'committed');
  attemptId = (await service.get({ teamId })).attempts.at(-1).attemptId;
  await selfProof(service, teamId, attemptId, 'complete-2');
  await service.dispatch({ requestId: 'review-fail-2', teamId, action: 'quality.review', payload: { taskId: 'task-1', attemptId, ...reviewer, verdict: 'fail' } }, asMember(teamId, 'member-2', 'session-2'));

  view = await service.get({ teamId });
  assert.equal(view.tasks[0].state, 'anomalous');
  assert.equal(view.tasks[0].repairRounds, 2);
  assert.equal(view.attempts.length, 2);
  assert.equal(view.reviews.length, 2);
  assert.deepEqual(reviewAssignment(view, 'task-1'), { intervention: true, reason: 'Task is already in exception' });
});

test('a colony without an independent reviewer asks for a human instead of passing', async t => {
  const { service, teamId } = await fixture(t, 'solo', [member('member-1', 'session-1')]);
  await selfProof(service, teamId);
  const view = await service.get({ teamId });
  assert.deepEqual(reviewAssignment(view, 'task-1'), { intervention: true, reason: 'No independent reviewer is available' });
  assert.deepEqual(openReviews(view).map(item => item.intervention), [true]);
  assert.equal((await service.get({ teamId })).tasks[0].state, 'running');
});
