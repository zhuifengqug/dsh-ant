import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';
import { pendingRelease } from '../../src/core/gate.mjs';
import { releaseBatch, runSchedule } from '../../src/core/scheduler.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const member = (id, sessionId) => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] });
const task = id => ({ taskId: id, title: id, objective: id, inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'] });
const evidence = [{ kind: 'command', locator: 'node --test', note: 'green' }];

async function fixture(t, tag, maxActiveAttempts = 8) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-batch-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const plan = {
    planId: 'plan-1', mode: 'normal', maxActiveAttempts,
    tasks: [task('task-1'), task('task-2'), task('task-3')],
    dependencies: [{ taskId: 'task-3', blockedByTaskId: 'task-1' }],
    qualityGates: [],
  };
  const payload = { goal: 'Release a batch', workspaceRelativePath: '.', plan, members: [member('member-1', 'session-1'), member('member-2', 'session-2'), member('member-3', 'session-3')] };
  const created = await service.dispatch({ requestId: `create-${tag}`, action: 'team.create', payload }, user);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: `confirm-${tag}`, teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  return { service, teamId };
}

async function passGate(service, teamId, taskId, executor = 'member-1', reviewer = 'member-3') {
  const view = await service.get({ teamId });
  const attempt = [...view.attempts].reverse().find(item => item.taskId === taskId);
  await service.dispatch({ requestId: `complete-${taskId}`, teamId, action: 'task.complete', payload: { taskId, attemptId: attempt.attemptId, summary: 'done', evidence } }, { actor: 'agent', teamId, memberId: executor, sessionId: executor === 'member-1' ? 'session-1' : 'session-2' });
  await service.dispatch({ requestId: `review-${taskId}`, teamId, action: 'quality.review', payload: { taskId, attemptId: attempt.attemptId, reviewerMemberId: reviewer, verdict: 'pass', criteria: ['tests pass'], summary: 'peer review' } }, { actor: 'agent', teamId, memberId: reviewer, sessionId: 'session-3' });
}

test('a gate-passed task waits for one human release instead of being dispatched', async t => {
  const { service, teamId } = await fixture(t, 'wait');
  await runSchedule({ service, teamId });
  await passGate(service, teamId, 'task-1');

  const view = await service.get({ teamId });
  assert.equal(view.tasks.find(item => item.taskId === 'task-1').state, 'reviewed');
  assert.deepEqual(pendingRelease(view).map(item => item.taskId), ['task-1']);

  const tick = await runSchedule({ service, teamId });
  assert.equal(tick.dispatched.some(item => item.taskId === 'task-1'), false);
  assert.equal(tick.ready.includes('task-3'), false);
});

test('one release dispatches the batch downstream within the concurrency cap', async t => {
  const { service, teamId } = await fixture(t, 'cap', 1);
  await runSchedule({ service, teamId });
  await passGate(service, teamId, 'task-1');
  const released = await releaseBatch({ service, teamId, taskIds: ['task-1'] });
  assert.equal(released.receipt.outcome, 'committed');

  const view = await service.get({ teamId });
  assert.equal(view.tasks.find(item => item.taskId === 'task-1').state, 'released');
  assert.deepEqual(pendingRelease(view), []);
  assert.ok(view.attempts.filter(item => item.state === 'running').length <= 1);
});

test('the model cannot release a batch', async t => {
  const { service, teamId } = await fixture(t, 'model');
  await runSchedule({ service, teamId });
  await passGate(service, teamId, 'task-1');
  await assert.rejects(
    service.dispatch({ requestId: 'release-by-model', teamId, action: 'batch.release', payload: { batchId: 'batch-1', taskIds: ['task-1'] } }, { actor: 'agent', teamId, memberId: 'member-1', sessionId: 'session-1' }),
    { code: 'team/forbidden' },
  );
  assert.equal((await service.get({ teamId })).tasks.find(item => item.taskId === 'task-1').state, 'reviewed');
});

test('an unreleased batch neither expires nor self-releases', async t => {
  const { service, teamId } = await fixture(t, 'stale');
  await runSchedule({ service, teamId });
  await passGate(service, teamId, 'task-1');
  for (const attempt of [1, 2, 3]) await runSchedule({ service, teamId });

  const view = await service.get({ teamId });
  assert.equal(view.tasks.find(item => item.taskId === 'task-1').state, 'reviewed');
  assert.deepEqual(pendingRelease(view).map(item => item.taskId), ['task-1']);
  assert.equal(view.tasks.find(item => item.taskId === 'task-3').state, 'pending');
  assert.ok(view.cursor > 0);
});
