import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';
import { evaluateSchedule, runSchedule } from '../../src/core/scheduler.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const member = (id, sessionId) => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] });
const task = id => ({ taskId: id, title: id, objective: id, inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'] });
const payload = (maxActiveAttempts, tasks, members) => ({
  goal: 'Schedule a graph',
  workspaceRelativePath: '.',
  plan: { planId: 'plan-1', mode: 'normal', maxActiveAttempts, tasks, dependencies: [{ taskId: 'task-3', blockedByTaskId: 'task-1' }], qualityGates: [] },
  members,
});

async function fixture(t, tag, plan) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-scheduler-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const created = await service.dispatch({ requestId: `create-${tag}`, action: 'team.create', payload: plan }, user);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: `confirm-${tag}`, teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  return { service, teamId };
}

const threeTasks = [task('task-1'), task('task-2'), task('task-3')];

test('two independent tasks start on their own and the downstream task follows its upstream', async t => {
  const { service, teamId } = await fixture(t, 'ready', payload(8, threeTasks, [member('member-1', 'session-1'), member('member-2', 'session-2')]));
  const first = await runSchedule({ service, teamId });
  assert.deepEqual(first.dispatched.map(item => item.taskId), ['task-1', 'task-2']);
  assert.deepEqual(first.ready, ['task-1', 'task-2']);
  assert.deepEqual(first.queued, []);

  let view = await service.get({ teamId });
  const attempt = view.attempts.find(item => item.taskId === 'task-1');
  await service.dispatch({ requestId: 'complete-1', teamId, action: 'task.complete', payload: { taskId: 'task-1', attemptId: attempt.attemptId, summary: 'done', evidence: [{ kind: 'command', locator: 'node --test', note: 'green' }] } }, { actor: 'agent', teamId, memberId: 'member-1', sessionId: 'session-1' });

  await service.dispatch({ requestId: 'terminate-1', teamId, action: 'attempt.terminate', payload: { taskId: 'task-1', attemptId: attempt.attemptId } }, user);

  const second = await runSchedule({ service, teamId });
  assert.deepEqual(second.ready, ['task-3']);
  assert.equal(second.queued.length, 0);
  assert.deepEqual(second.wake, []);

  view = await service.get({ teamId });
  assert.ok(view.attempts.some(item => item.taskId === 'task-3' && item.state === 'running'));
});

test('a member holding an open attempt is woken instead of being given a new identity', async t => {
  const { service, teamId } = await fixture(t, 'wake', payload(8, threeTasks, [member('member-1', 'session-1')]));
  await runSchedule({ service, teamId });
  const view = await service.get({ teamId });
  const attempt = view.attempts.find(item => item.taskId === 'task-1');
  await service.dispatch({ requestId: 'pause-1', teamId, action: 'attempt.pause', payload: { taskId: 'task-1', attemptId: attempt.attemptId } }, { actor: 'system', teamId });

  const paused = await service.get({ teamId });
  assert.deepEqual(evaluateSchedule(paused).wake, ['member-1']);
  const tick = await runSchedule({ service, teamId });
  assert.deepEqual(tick.dispatched, []);
  const after = await service.get({ teamId });
  assert.equal(after.attempts.length, 1);
});

test('the concurrency cap queues the surplus instead of oversubscribing', async t => {
  const { service, teamId } = await fixture(t, 'cap', payload(1, threeTasks, [member('member-1', 'session-1'), member('member-2', 'session-2')]));
  const tick = await runSchedule({ service, teamId });
  assert.equal(tick.dispatched.length, 1);
  assert.deepEqual(tick.ready, ['task-1', 'task-2']);
  assert.deepEqual(tick.queued, ['task-2']);
  const view = await service.get({ teamId });
  assert.equal(view.attempts.filter(item => item.state === 'running').length, 1);
});
