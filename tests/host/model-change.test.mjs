import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { AntService } from '../../src/host/service.mjs';

const task = { taskId: 'panel', title: '面板', objective: '把面板做出来', inScope: ['.'], outOfScope: [], acceptance: ['可用'], verify: [] };
const member = {
  memberId: 'worker', role: 'worker', sessionMode: 'persistent', sessionId: 'session-worker',
  provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [],
};

async function fixture(t, { selectFails = false } = {}) {
  const models = [];
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ant-model-change-'));
  const context = new Context();
  context.provide('sessionController', {
    async resolveAgent(id) { return { agent: { session: { id } } }; },
    async prompt() { return { accepted: true }; },
    async cancel() { return { accepted: true }; },
    async selectModel(request) {
      models.push(request);
      if (selectFails) throw new Error('ui-model-selection: session is gone');
      return { provider: request.provider, model: request.model };
    },
  });
  const service = new AntService(context, { workspaceRoot, ownerId: 'model-change-host' });
  t.after(async () => {
    await service.close();
    await rm(workspaceRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  });
  const created = await service.dispatchAsOwner({
    requestId: 'create-model-change',
    action: 'team.create',
    payload: {
      goal: '换模型',
      workspaceRelativePath: '.',
      plan: { planId: 'plan-1', mode: 'normal', maxActiveAttempts: 1, tasks: [task], dependencies: [], qualityGates: [] },
      members: [member],
    },
  });
  return { service, teamId: created.teamId, models };
}

test('a committed model change also switches the member Session', async t => {
  const { service, teamId, models } = await fixture(t);
  assert.equal(models.length, 0);

  await service.dispatchAsOwner({
    requestId: 'change-model',
    teamId,
    action: 'member.changeModel',
    payload: { memberId: 'worker', provider: 'anthropic', model: 'claude-sonnet-4-6', reasoningEffort: 'high' },
  });

  assert.deepEqual(models, [{ sessionId: 'session-worker', provider: 'anthropic', model: 'claude-sonnet-4-6', reasoningEffort: 'high' }]);
  const view = await service.get({ teamId });
  assert.equal(view.members[0].provider, 'anthropic');
  assert.equal(view.members[0].model, 'claude-sonnet-4-6');
  assert.equal(view.members[0].reasoningEffort, 'high');
});

test('a Session that refuses the switch leaves the record standing', async t => {
  const { service, teamId, models } = await fixture(t, { selectFails: true });

  await service.dispatchAsOwner({
    requestId: 'change-model-2',
    teamId,
    action: 'member.changeModel',
    payload: { memberId: 'worker', provider: 'anthropic', model: 'claude-sonnet-4-6' },
  });

  assert.equal(models.length, 1);
  const view = await service.get({ teamId });
  assert.equal(view.members[0].model, 'claude-sonnet-4-6');
});
