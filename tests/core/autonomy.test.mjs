import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';
import { createSettingsStore, normalizeSettings, DEFAULT_SETTINGS } from '../../src/host/settings.mjs';
import { autonomyPolicy, capacityOf, variantsFor } from '../../src/core/autonomy.mjs';
import { runSchedule, releaseBatch } from '../../src/core/scheduler.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const member = (id, sessionId) => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] });
const task = (id, readOnly) => ({ taskId: id, title: id, objective: id, inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'], ...(readOnly ? { readOnly: true } : {}) });
const evidence = [{ kind: 'command', locator: 'node --test', note: 'green' }];

async function fixture(t, tag) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-autonomy-'));
  const store = createSettingsStore({ file: path.join(root, 'ant.json') });
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host', config: { readSettings: () => store.read() } });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const plan = {
    planId: 'plan-1', mode: 'normal', maxActiveAttempts: 8,
    tasks: [task('task-1', true), task('task-2', true), task('task-3', true)],
    dependencies: [{ taskId: 'task-3', blockedByTaskId: 'task-1' }],
    qualityGates: [],
  };
  const payload = { goal: `Autonomy settings ${tag}`, workspaceRelativePath: '.', plan, members: [member('member-1', 'session-1'), member('member-2', 'session-2'), member('member-3', 'session-3')] };
  const created = await service.dispatch({ requestId: `create-${tag}`, action: 'team.create', payload }, user);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: `confirm-${tag}`, teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  return { service, teamId, store };
}

async function passGate(service, teamId, taskId) {
  const view = await service.get({ teamId });
  const attempt = [...view.attempts].reverse().find(item => item.taskId === taskId);
  const sessionId = view.members.find(item => item.memberId === attempt.memberId)?.sessionId ?? 'session-1';
  await service.dispatch({ requestId: `complete-${taskId}`, teamId, action: 'task.complete', payload: { taskId, attemptId: attempt.attemptId, summary: 'done', evidence } }, { actor: 'agent', teamId, memberId: attempt.memberId, sessionId });
  await service.dispatch({ requestId: `review-${taskId}`, teamId, action: 'quality.review', payload: { taskId, attemptId: attempt.attemptId, reviewerMemberId: 'member-3', verdict: 'pass', criteria: ['tests pass'], summary: 'peer review' } }, { actor: 'agent', teamId, memberId: 'member-3', sessionId: 'session-3' });
}

test('the settings document defaults, merges atomically and refuses out-of-range patches', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-settings-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const file = path.join(root, 'ant.json');
  const store = createSettingsStore({ file });

  assert.deepEqual(await store.read(), DEFAULT_SETTINGS);
  const written = await store.write({ autonomy: 'L3', batchWindowMinutes: 45 });
  assert.deepEqual(written, { ...DEFAULT_SETTINGS, autonomy: 'L3', batchWindowMinutes: 45 });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), written);
  assert.deepEqual(await createSettingsStore({ file }).read(), written);

  await assert.rejects(store.write({ maxActiveAttempts: 9 }), error => error.code === 'team/invalid-action');
  assert.throws(() => normalizeSettings({ autonomy: 'L9' }), error => error.code === 'team/invalid-action');

  await writeFile(file, '{ broken', 'utf8');
  await assert.rejects(createSettingsStore({ file }).read(), /not valid JSON/);
});

test('the settings cap wins over the plan cap and the policy is read fresh every tick', async t => {
  const { service, teamId, store } = await fixture(t, 'cap');
  await store.write({ maxActiveAttempts: 1 });

  const view = await service.get({ teamId });
  assert.equal(view.plan.maxActiveAttempts, 8);
  assert.equal(capacityOf(view, autonomyPolicy(await store.read())), 1);

  const tick = await runSchedule({ service, teamId, settings: await store.read() });
  assert.equal(tick.capacity, 1);
  assert.equal(tick.dispatched.length, 1);
  assert.deepEqual(tick.queued, ['task-2']);

  assert.equal(capacityOf(await service.get({ teamId }), autonomyPolicy(DEFAULT_SETTINGS)), 8);

  assert.equal(variantsFor(task('t', true), autonomyPolicy({ defaultVariants: 2 })), 2);
  assert.equal(variantsFor(task('t', false), autonomyPolicy({ defaultVariants: 2 })), 1);
  assert.equal(variantsFor(task('t', false), autonomyPolicy({ defaultVariants: 2, variantWriteTasks: true })), 2);
});

test('L2 keeps every gate-passed task waiting for a human click', async t => {
  const { service, teamId, store } = await fixture(t, 'l2');
  await store.write({ autonomy: 'L2' });
  await runSchedule({ service, teamId });
  await passGate(service, teamId, 'task-1');

  const late = await runSchedule({ service, teamId, settings: await store.read(), now: Date.now() + 7 * 24 * 3600 * 1000 });
  assert.equal(late.released, undefined);
  assert.equal((await service.get({ teamId })).tasks.find(item => item.taskId === 'task-1').state, 'reviewed');
});

test('L3 releases a closed window on its own and records the release like a human one', async t => {
  const { service, teamId, store } = await fixture(t, 'l3');
  await store.write({ autonomy: 'L3', batchWindowMinutes: 30 });
  await runSchedule({ service, teamId });
  await passGate(service, teamId, 'task-1');

  const early = await runSchedule({ service, teamId, settings: await store.read() });
  assert.equal(early.released, undefined);

  const late = await runSchedule({ service, teamId, settings: await store.read(), now: Date.now() + 31 * 60 * 1000 });
  assert.deepEqual(late.released.taskIds, ['task-1']);
  const view = await service.get({ teamId });
  assert.equal(view.tasks.find(item => item.taskId === 'task-1').state, 'released');
  assert.deepEqual(view.batches.at(-1).taskIds, ['task-1']);
  assert.equal(view.batches.at(-1).releasedBy, undefined);
});

test('L1 refuses to release more than one task at a time', async t => {
  const { service, teamId, store } = await fixture(t, 'l1');
  await store.write({ autonomy: 'L1' });
  await runSchedule({ service, teamId });
  await passGate(service, teamId, 'task-1');
  await passGate(service, teamId, 'task-2');

  await assert.rejects(
    releaseBatch({ service, teamId, taskIds: ['task-1', 'task-2'], settings: await store.read() }),
    error => /L1 releases one task at a time/.test(error.message),
  );
  const one = await releaseBatch({ service, teamId, taskIds: ['task-1'], settings: await store.read() });
  assert.equal(one.receipt.outcome, 'committed');
});
