import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { AntService } from '../../src/host/service.mjs';
import { createAntTools } from '../../src/host/tool.mjs';
import { runSchedule } from '../../src/core/scheduler.mjs';

const request = (overrides = {}) => ({
  requestId: 'create-hatch',
  action: 'team.create',
  payload: {
    goal: '建队即孵化成员会话',
    workspaceRelativePath: '.',
    leadMemberId: 'queen',
    plan: {
      planId: 'plan-hatch', mode: 'normal', maxActiveAttempts: 2,
      tasks: [{ taskId: 'core', title: '实现', objective: '把 core 做出来', inScope: ['.'], outOfScope: [], acceptance: ['可用'], verify: [] }],
      dependencies: [],
      qualityGates: [],
    },
    members: [
      { memberId: 'worker', role: 'worker', sessionMode: 'ephemeral', provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [] },
      { memberId: 'queen', role: 'queen', sessionMode: 'persistent', provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [] },
    ],
    ...overrides,
  },
});

async function fixture(t, { failCreate = false } = {}) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ant-hatch-'));
  const prompts = [];
  const created = [];
  const selections = [];
  let counter = 0;
  const controller = {
    async create(value) {
      created.push(value);
      if (failCreate) throw new Error('session provider is unavailable');
      counter += 1;
      return { sessionId: 'session-hatched-' + counter };
    },
    async selectModel(value) { selections.push(value); return { provider: value.provider, model: value.model }; },
    async prompt(value, signal) { signal.throwIfAborted(); prompts.push(value); return { accepted: true }; },
  };
  const context = new Context();
  context.provide('sessionController', controller);
  const service = new AntService(context, { workspaceRoot, ownerId: 'hatch-host' });
  t.after(async () => { await service.close(); await rm(workspaceRoot, { recursive: true, force: true }); });
  const tools = createAntTools(service);
  const dispatch = tools.find(item => item.name === 'ant_team_dispatch');
  const asAgent = sessionId => ({ agent: { session: { id: sessionId } } });
  const receipt = await dispatch.execute({ request: request() }, asAgent('session-queen'));
  return { service, created, selections, prompts, dispatch, teamId: receipt.teamId, workspaceRoot };
}

async function confirm(service, teamId) {
  const view = await service.get({ teamId });
  await service.dispatchAsOwner({ requestId: 'confirm', teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor });
}

test('a tick hatches the Session of an ephemeral member and wakes it with the work', async t => {
  const { service, created, selections, prompts, teamId, workspaceRoot } = await fixture(t);
  await confirm(service, teamId);
  const tick = await runSchedule({ service, teamId });
  assert.deepEqual(tick.hatched.map(item => item.memberId), ['worker']);
  assert.equal(created.length, 1);
  assert.equal(created[0].cwd, workspaceRoot);
  assert.deepEqual(selections.map(item => [item.provider, item.model]), [['fixture', 'fixture-model']]);
  const view = await service.get({ teamId });
  const worker = view.members.find(item => item.memberId === 'worker');
  assert.equal(worker.sessionId, 'session-hatched-1');
  assert.equal(worker.status, 'active');
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].sessionId, 'session-hatched-1');
});

test('a hatched member is bound once, so a later tick does not hatch again', async t => {
  const { service, created, teamId } = await fixture(t);
  await confirm(service, teamId);
  await runSchedule({ service, teamId });
  const second = await runSchedule({ service, teamId });
  assert.equal(second.hatched, undefined);
  assert.equal(created.length, 1);
});

test('a staged colony hatches nothing and dispatches nothing', async t => {
  const { service, created, teamId } = await fixture(t);
  await assert.rejects(runSchedule({ service, teamId }), /confirmed team/);
  assert.equal(created.length, 0);
  const view = await service.get({ teamId });
  assert.equal(view.members.find(item => item.memberId === 'worker').sessionId, undefined);
});

test('a refused Session creation leaves the member unhatched for the next tick', async t => {
  const { service, prompts, teamId } = await fixture(t, { failCreate: true });
  await confirm(service, teamId);
  const tick = await runSchedule({ service, teamId });
  assert.equal(tick.hatched[0].memberId, 'worker');
  assert.match(tick.hatched[0].error, /unavailable/);
  const view = await service.get({ teamId });
  assert.equal(view.members.find(item => item.memberId === 'worker').sessionId, undefined);
  assert.deepEqual(prompts.map(item => item.sessionId), ['session-queen']);
});
