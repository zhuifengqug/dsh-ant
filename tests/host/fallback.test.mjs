import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { AntService } from '../../src/host/service.mjs';
import { runSchedule } from '../../src/core/scheduler.mjs';

const task = { taskId: 'core', title: '实现', objective: '把 core 做出来', inScope: ['.'], outOfScope: [], acceptance: ['可用'], verify: [] };
const member = {
  memberId: 'worker', role: 'worker', sessionMode: 'persistent', sessionId: 'session-worker',
  provider: 'fixture', model: 'fixture-model', fallback: { provider: 'backup', model: 'backup-model' },
  inScope: ['.'], outOfScope: [],
};

async function fixture(t) {
  const calls = { prompts: [], models: [] };
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ant-fallback-host-'));
  const context = new Context();
  context.provide('sessionController', {
    async resolveAgent(sessionId) { return { agent: { session: { id: sessionId } } }; },
    async prompt(request) { calls.prompts.push(request); return { accepted: true }; },
    async cancel() { return { accepted: true }; },
    async selectModel(request) { calls.models.push(request); return { provider: request.provider, model: request.model }; },
  });
  const service = new AntService(context, { workspaceRoot, ownerId: 'fallback-host' });
  t.after(async () => { await service.close(); await rm(workspaceRoot, { recursive: true, force: true }); });

  const created = await service.dispatchAsOwner({
    requestId: 'create-fallback',
    action: 'team.create',
    payload: { goal: '换模型继续', workspaceRelativePath: '.', plan: { planId: 'plan-1', mode: 'normal', maxActiveAttempts: 1, tasks: [task], dependencies: [], qualityGates: [] }, members: [member] },
  });
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatchAsOwner({ requestId: 'confirm-fallback', teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor });
  return { service, teamId, calls };
}

test('the spare model is selected in the Session before the fallback brief lands', async t => {
  const { service, teamId, calls } = await fixture(t);

  const tick = await runSchedule({ service, teamId });
  assert.equal(tick.dispatched.length, 1);
  assert.equal(calls.prompts.length, 1);
  assert.equal(calls.models.length, 0, 'a normal dispatch never touches the model selection');
  const first = (await service.get({ teamId })).attempts[0].attemptId;

  await service.interruptRun({ teamId, taskId: 'core', attemptId: first, kind: 'error', reason: 'provider rejected the request' });
  await service.dispatchAsOwner({ requestId: 'fallback-host', teamId, action: 'attempt.fallback', payload: { taskId: 'core', previousAttemptId: first, memberId: 'worker' } });
  const next = (await service.get({ teamId })).attempts.at(-1);

  const delivered = await service.deliverWork({ teamId, assignments: [{ taskId: 'core', memberId: 'worker', attemptId: next.attemptId }] });
  assert.equal(delivered[0].delivered, true);
  assert.equal(delivered[0].model, 'backup/backup-model');
  assert.deepEqual(calls.models, [{ sessionId: 'session-worker', provider: 'backup', model: 'backup-model' }]);
  assert.equal(calls.prompts.length, 2);
  assert.match(calls.prompts[1].content[0].text, /backup\/backup-model/);
  assert.match(calls.prompts[1].content[0].text, /回退/);
  assert.equal(calls.prompts[1].sessionId, 'session-worker');
});
