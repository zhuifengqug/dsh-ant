import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';
import { runSchedule } from '../../src/core/scheduler.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const member = (id, sessionId) => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] });
const task = (id, owner) => ({ taskId: id, title: id, objective: id, ownerMemberId: owner, inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'] });

async function fixture(t, tag) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-interrupt-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const plan = { planId: 'plan-1', mode: 'normal', maxActiveAttempts: 4, tasks: [task('task-1', 'member-1')], dependencies: [], qualityGates: [] };
  const created = await service.dispatch({ requestId: 'create-' + tag, action: 'team.create', payload: { goal: 'Survive a stopped run', workspaceRelativePath: '.', plan, members: [member('member-1', 'session-1'), member('member-2', 'session-2')] } }, user);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: 'confirm-' + tag, teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  await runSchedule({ service, teamId });
  const started = await service.get({ teamId });
  return { service, teamId, attempt: started.attempts[0] };
}

test('an output limit fails the attempt so the lead can retry it', async t => {
  const { service, teamId, attempt } = await fixture(t, 'limit');
  const receipt = await service.dispatch({ requestId: 'limit-1', teamId, action: 'run.interrupted', payload: { reason: 'model hit the output ceiling', kind: 'output-limit', taskId: 'task-1', attemptId: attempt.attemptId } }, { actor: 'system', teamId });
  assert.equal(receipt.outcome, 'committed');

  const stopped = await service.get({ teamId });
  assert.equal(stopped.lifecycle, 'interrupted');
  assert.equal(stopped.attempts[0].state, 'failed');
  assert.equal(stopped.tasks[0].state, 'failed');
  assert.equal(stopped.interruptions.at(-1).kind, 'output-limit');

  await service.dispatch({ requestId: 'move-1', teamId, action: 'task.reassign', payload: { taskId: 'task-1', memberId: 'member-2', reason: 'the run died on that seat' } }, user);
  const retried = await service.dispatch({ requestId: 'retry-1', teamId, action: 'attempt.retry', payload: { taskId: 'task-1', previousAttemptId: attempt.attemptId, memberId: 'member-2' } }, { actor: 'system', teamId });
  assert.equal(retried.outcome, 'committed');
  const restarted = await service.get({ teamId });
  assert.equal(restarted.tasks[0].state, 'running');
  assert.equal(restarted.attempts.length, 2);
  assert.equal(restarted.attempts.at(-1).memberId, 'member-2');
});

test('an aborted run terminates its attempt instead of failing it', async t => {
  const { service, teamId, attempt } = await fixture(t, 'abort');
  await service.dispatch({ requestId: 'abort-1', teamId, action: 'run.interrupted', payload: { reason: 'cancelled by the owner', kind: 'aborted', taskId: 'task-1', attemptId: attempt.attemptId } }, { actor: 'system', teamId });
  const stopped = await service.get({ teamId });
  assert.equal(stopped.attempts[0].state, 'terminated');
  assert.equal(stopped.tasks[0].state, 'terminated');
});

test('an interruption that names no attempt leaves the work in place', async t => {
  const { service, teamId } = await fixture(t, 'scope');
  await service.dispatch({ requestId: 'scope-1', teamId, action: 'run.interrupted', payload: { reason: 'host is shutting down' } }, { actor: 'system', teamId });
  const view = await service.get({ teamId });
  assert.equal(view.lifecycle, 'interrupted');
  assert.equal(view.attempts[0].state, 'running');
  assert.equal(view.tasks[0].state, 'running');
});

test('a member cannot report an interruption for someone else\'s attempt', async t => {
  const { service, teamId, attempt } = await fixture(t, 'who');
  await assert.rejects(
    service.dispatch({ requestId: 'who-1', teamId, action: 'run.interrupted', payload: { reason: 'not mine', kind: 'output-limit', taskId: 'task-1', attemptId: attempt.attemptId } }, { actor: 'agent', teamId, memberId: 'member-2', sessionId: 'session-2' }),
    error => { assert.equal(error.code, 'team/forbidden'); return true; },
  );
});
