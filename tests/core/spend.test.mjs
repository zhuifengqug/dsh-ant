import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';
import { runSchedule } from '../../src/core/scheduler.mjs';
import { summarizeSpend, settleWithSpend } from '../../src/core/spend.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const member = (id, sessionId) => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] });
const task = (id, readOnly = false) => ({ taskId: id, title: id, objective: id, inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'], readOnly });
const evidence = [{ kind: 'command', locator: 'node --test', note: 'green' }];

async function fixture(t, tag, tasks = [task('task-1')]) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-spend-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const plan = { planId: 'plan-1', mode: 'normal', maxActiveAttempts: 8, tasks, dependencies: [], qualityGates: [] };
  const payload = { goal: 'Spend', workspaceRelativePath: '.', plan, members: [member('member-1', 'session-1'), member('member-2', 'session-2'), member('member-3', 'session-3')] };
  const created = await service.dispatch({ requestId: `create-${tag}`, action: 'team.create', payload }, user);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: `confirm-${tag}`, teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  return { service, teamId };
}

const settle = async (service, teamId, taskId, attemptId, requestId) => service.dispatch({ requestId, teamId, action: 'attempt.terminate', payload: { taskId, attemptId } }, user);

test('spend lands once per attempt when the attempt settles', async t => {
  const { service, teamId } = await fixture(t, 'once');
  await runSchedule({ service, teamId });
  const view = await service.get({ teamId });
  const attemptId = view.attempts[0].attemptId;

  await assert.rejects(
    service.dispatch({ requestId: 'spend-open', teamId, action: 'spend.record', payload: { taskId: 'task-1', attemptId, tokensIn: 10, tokensOut: 5 } }, { actor: 'system', teamId }),
    error => error.code === 'team/invalid-state' && /settled/.test(error.message),
  );

  await settle(service, teamId, 'task-1', attemptId, 'terminate-1');
  const recorded = await service.dispatch({ requestId: 'spend-1', teamId, action: 'spend.record', payload: { taskId: 'task-1', attemptId, tokensIn: 1200, tokensOut: 800, costMicros: 4500, model: 'deepseek-v4' } }, { actor: 'system', teamId });
  assert.equal(recorded.outcome, 'committed');

  await assert.rejects(
    service.dispatch({ requestId: 'spend-again', teamId, action: 'spend.record', payload: { taskId: 'task-1', attemptId, tokensIn: 1, tokensOut: 1 } }, { actor: 'system', teamId }),
    error => error.code === 'team/invalid-state' && /already/.test(error.message),
  );

  const after = await service.get({ teamId });
  assert.equal(after.spend.length, 1);
  assert.equal(after.spend[0].tokensIn, 1200);
  assert.equal(after.attempts[0].spend.costMicros, 4500);
});

test('spend aggregates by member, task and attempt', async t => {
  const { service, teamId } = await fixture(t, 'aggregate', [task('task-1'), task('task-2')]);
  await runSchedule({ service, teamId });
  let view = await service.get({ teamId });
  const first = view.attempts.find(item => item.taskId === 'task-1');
  const second = view.attempts.find(item => item.taskId === 'task-2');

  await settle(service, teamId, 'task-1', first.attemptId, 'terminate-1');
  await service.dispatch({ requestId: 'spend-1', teamId, action: 'spend.record', payload: { taskId: 'task-1', attemptId: first.attemptId, tokensIn: 100, tokensOut: 40, costMicros: 1000 } }, { actor: 'system', teamId });
  await settle(service, teamId, 'task-2', second.attemptId, 'terminate-2');
  await service.dispatch({ requestId: 'spend-2', teamId, action: 'spend.record', payload: { taskId: 'task-2', attemptId: second.attemptId, tokensIn: 300, tokensOut: 60, costMicros: 2500 } }, { actor: 'system', teamId });

  view = await service.get({ teamId });
  const summary = summarizeSpend(view);
  assert.equal(summary.attempts, 2);
  assert.deepEqual(Object.keys(summary.byTask).sort(), ['task-1', 'task-2']);
  assert.equal(summary.byTask['task-2'].costMicros, 2500);
  assert.equal(summary.byTask['task-1'].tokensIn + summary.byTask['task-2'].tokensIn, 400);
  assert.equal(summary.byMember[first.memberId].costMicros, 1000);
  assert.equal(summary.byAttempt[second.attemptId].tokensOut, 60);
});

test('an attempt without usage data is reported as unknown, never as zero', async t => {
  const { service, teamId } = await fixture(t, 'unknown');
  await runSchedule({ service, teamId });
  const view = await service.get({ teamId });
  const attemptId = view.attempts[0].attemptId;
  await settle(service, teamId, 'task-1', attemptId, 'terminate-1');
  await service.dispatch({ requestId: 'spend-unknown', teamId, action: 'spend.record', payload: { taskId: 'task-1', attemptId, source: 'host-missing' } }, { actor: 'system', teamId });

  const summary = summarizeSpend((await service.get({ teamId })));
  assert.equal(summary.byAttempt[attemptId].unknown, 1);
  assert.equal(summary.byAttempt[attemptId].tokensIn, 0);
  assert.equal(summary.rows[0].known, false);
  assert.equal(summary.rows[0].tokensIn, null);
});

test('recorded cost never blocks the next dispatch', async t => {
  const { service, teamId } = await fixture(t, 'readonly-cost', [task('task-1'), task('task-2')]);
  await runSchedule({ service, teamId });
  const view = await service.get({ teamId });
  const attemptId = view.attempts[0].attemptId;
  await settle(service, teamId, 'task-1', attemptId, 'terminate-1');
  await service.dispatch({ requestId: 'spend-1', teamId, action: 'spend.record', payload: { taskId: 'task-1', attemptId, tokensIn: 10, tokensOut: 10, costMicros: 999999 } }, { actor: 'system', teamId });

  const before = await service.get({ teamId });
  assert.equal(before.tasks.find(item => item.taskId === 'task-2').state, 'running');
  const tick = await runSchedule({ service, teamId });
  assert.equal(tick.capacity, 8);
  assert.deepEqual(tick.dispatched, []);
});

test('a read-only task may run two candidates side by side', async t => {
  const { service, teamId } = await fixture(t, 'sample', [task('task-1', true)]);
  const system = { actor: 'system', teamId };
  await service.dispatch({ requestId: 'sample-1', teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-1', variants: 2 } }, system);
  await service.dispatch({ requestId: 'sample-2', teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-2', variants: 2 } }, system);

  const view = await service.get({ teamId });
  assert.equal(view.attempts.length, 2);
  assert.deepEqual(view.attempts.map(item => item.variant), [1, 2]);
  assert.deepEqual(view.attempts.map(item => item.variants), [2, 2]);
  assert.deepEqual(view.attempts.map(item => item.memberId), ['member-1', 'member-2']);
});

test('a write task refuses parallel candidates before anything is committed', async t => {
  const { service, teamId } = await fixture(t, 'write', [task('task-1')]);
  await runSchedule({ service, teamId });
  await assert.rejects(
    service.dispatch({ requestId: 'sample-write', teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-2', variants: 2 } }, { actor: 'system', teamId }),
    error => error.code === 'team/invalid-state' && /may not run candidates in parallel/.test(error.message),
  );
  assert.equal((await service.get({ teamId })).attempts.length, 1);
});

test('selecting a candidate discards the others but keeps their cost', async t => {
  const { service, teamId } = await fixture(t, 'pick', [task('task-1', true)]);
  const system = { actor: 'system', teamId };
  await service.dispatch({ requestId: 'sample-1', teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-1', variants: 2 } }, system);
  await service.dispatch({ requestId: 'sample-2', teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-2', variants: 2 } }, system);
  const view = await service.get({ teamId });
  const [winner, loser] = view.attempts;

  await service.dispatch({ requestId: 'select-1', teamId, action: 'attempt.select', payload: { taskId: 'task-1', attemptId: winner.attemptId, variant: winner.variant } }, user);
  const picked = await service.get({ teamId });
  const discarded = picked.attempts.find(item => item.attemptId === loser.attemptId);
  assert.equal(discarded.state, 'terminated');
  assert.equal(picked.tasks[0].selectedAttemptId, winner.attemptId);

  await settle(service, teamId, 'task-1', winner.attemptId, 'terminate-winner');
  await service.dispatch({ requestId: 'spend-winner', teamId, action: 'spend.record', payload: { taskId: 'task-1', attemptId: winner.attemptId, tokensIn: 500, tokensOut: 200, costMicros: 2000 } }, { actor: 'system', teamId });
  await service.dispatch({ requestId: 'spend-loser', teamId, action: 'spend.record', payload: { taskId: 'task-1', attemptId: loser.attemptId, tokensIn: 480, tokensOut: 190, costMicros: 1900 } }, { actor: 'system', teamId });

  const summary = summarizeSpend(await service.get({ teamId }));
  assert.equal(Object.keys(summary.byAttempt).length, 2);
  assert.equal(summary.byAttempt[loser.attemptId].costMicros, 1900);
});

test('one settlement call lands the cost exactly once', async t => {
  const { service, teamId } = await fixture(t, 'settle', [task('task-1')]);
  await runSchedule({ service, teamId });
  const view = await service.get({ teamId });
  const attemptId = view.attempts[0].attemptId;

  const receipt = await settleWithSpend({ service, teamId, taskId: 'task-1', attemptId, usage: { tokensIn: 900, tokensOut: 300, costMicros: 3200, model: 'deepseek-v4' } });
  assert.equal(receipt.outcome, 'committed');

  const again = await settleWithSpend({ service, teamId, taskId: 'task-1', attemptId, usage: { tokensIn: 900, tokensOut: 300, costMicros: 3200, model: 'deepseek-v4' } });
  assert.equal(again.outcome, 'duplicate');

  const after = await service.get({ teamId });
  assert.equal(after.attempts[0].state, 'terminated');
  assert.equal(after.spend.length, 1);
  assert.equal(summarizeSpend(after).byAttempt[attemptId].costMicros, 3200);
});

test('settling without usage still records an unknown bucket', async t => {
  const { service, teamId } = await fixture(t, 'settle-missing', [task('task-1')]);
  await runSchedule({ service, teamId });
  const attemptId = (await service.get({ teamId })).attempts[0].attemptId;
  await settleWithSpend({ service, teamId, taskId: 'task-1', attemptId });

  const summary = summarizeSpend(await service.get({ teamId }));
  assert.equal(summary.attempts, 1);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.rows[0].source, 'host-missing');
});
