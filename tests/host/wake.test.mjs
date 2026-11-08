import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { AntService } from '../../src/host/service.mjs';
import { createAntTools } from '../../src/host/tool.mjs';

const request = (overrides = {}) => ({
  requestId: 'create-wake',
  action: 'team.create',
  payload: {
    goal: '派工要叫醒成员',
    workspaceRelativePath: '.',
    leadMemberId: 'queen',
    plan: {
      planId: 'plan-wake', mode: 'normal', maxActiveAttempts: 2,
      tasks: [{ taskId: 'core', title: '实现', objective: '把 core 做出来', inScope: ['.'], outOfScope: [], acceptance: ['可用'], verify: [] }],
      dependencies: [],
      qualityGates: [{ gateId: 'core-review', taskId: 'core', kind: 'review', acceptance: ['审查'] }],
    },
    members: [
      { memberId: 'worker', role: 'worker', sessionMode: 'persistent', sessionId: 'session-worker', provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [] },
      { memberId: 'queen', role: 'queen', sessionMode: 'persistent', provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [] },
    ],
    ...overrides,
  },
});

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ant-wake-'));
  const prompts = [];
  // Mirrors the Host: prompt(request, signal) dereferences the caller signal before admission.
  const controller = { accept: true, async prompt(value, signal) { signal.throwIfAborted(); prompts.push(value); return { accepted: controller.accept }; } };
  const context = new Context();
  context.provide('sessionController', controller);
  const service = new AntService(context, { workspaceRoot, ownerId: 'wake-host' });
  t.after(async () => { await service.close(); await rm(workspaceRoot, { recursive: true, force: true }); });
  const tools = createAntTools(service);
  const dispatch = tools.find(item => item.name === 'ant_team_dispatch');
  const schedule = tools.find(item => item.name === 'ant_team_schedule');
  const release = tools.find(item => item.name === 'ant_team_release');
  const asAgent = sessionId => ({ agent: { session: { id: sessionId } } });
  const created = await dispatch.execute({ request: request() }, asAgent('session-queen'));
  const view = await service.get({ teamId: created.teamId });
  await service.dispatchAsOwner({ requestId: 'confirm', teamId: created.teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor });
  return { service, dispatch, schedule, release, asAgent, controller, prompts, teamId: created.teamId };
}

test('a dispatched attempt wakes the Session that must do the work', async t => {
  const { schedule, prompts, service, teamId } = await fixture(t);
  const tick = await schedule.execute({ teamId });
  assert.equal(tick.prompted.length, 1);
  assert.equal(tick.prompted[0].delivered, true);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].sessionId, 'session-worker');
  assert.match(prompts[0].requestId, /^work-/);
  const text = prompts[0].content[0].text;
  assert.match(text, /core/);
  assert.match(text, /把 core 做出来/);
  assert.match(text, /ant_team_dispatch/);
  const view = await service.get({ teamId });
  assert.equal(view.attempts[0].state, 'running');
});

test('a refused prompt pauses the attempt and the next tick resumes it', async t => {
  const { schedule, controller, prompts, service, teamId } = await fixture(t);
  controller.accept = false;
  const stalled = await schedule.execute({ teamId });
  assert.equal(stalled.prompted[0].delivered, false);
  let view = await service.get({ teamId });
  assert.equal(view.attempts[0].state, 'paused');

  controller.accept = true;
  const tick = await schedule.execute({ teamId });
  assert.equal(tick.resumed.length, 1);
  assert.equal(tick.resumed[0].attemptId, view.attempts[0].attemptId);
  assert.equal(tick.prompted[0].delivered, true);
  assert.equal(prompts.length, 2);
  view = await service.get({ teamId });
  assert.equal(view.attempts[0].state, 'running');
});

test('release belongs to the colony lead, not to any worker', async t => {
  const { dispatch, schedule, release, service, asAgent, teamId } = await fixture(t);
  await schedule.execute({ teamId });
  const view = await service.get({ teamId });
  const attemptId = view.attempts[0].attemptId;
  const done = await dispatch.execute({ request: { requestId: 'done', teamId, action: 'task.complete', payload: { taskId: 'core', attemptId, summary: '做完了', evidence: [{ kind: 'file', locator: 'src/core.mjs' }] } } }, asAgent('session-worker'));
  assert.equal(done.outcome, 'committed');
  const review = await dispatch.execute({ request: { requestId: 'review', teamId, action: 'quality.review', payload: { taskId: 'core', attemptId, reviewerMemberId: 'queen', verdict: 'pass', criteria: ['acceptance'], summary: '合格' } } }, asAgent('session-queen'));
  assert.equal(review.outcome, 'committed');

  const refused = await release.execute({ teamId, taskIds: ['core'] }, asAgent('session-worker'));
  assert.equal(refused.code, 'team/forbidden');
  assert.equal(refused.message, 'Release is reserved to the colony lead');
  assert.equal((await service.get({ teamId })).batches.length, 0);

  const released = await release.execute({ teamId, taskIds: ['core'] }, asAgent('session-queen'));
  assert.equal(released.receipt.outcome, 'committed');
  assert.deepEqual((await service.get({ teamId })).tasks.map(task => [task.taskId, task.state]), [['core', 'released']]);
});
