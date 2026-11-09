import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { AntService } from '../../src/host/service.mjs';

const request = {
  requestId: 'create-audit',
  action: 'team.create',
  payload: {
    goal: '收到的东西就是真的东西',
    workspaceRelativePath: '.',
    plan: {
      planId: 'plan-audit', mode: 'normal', maxActiveAttempts: 1,
      tasks: [{ taskId: 'core', title: '实现', objective: '把 core 做出来', inScope: ['.'], outOfScope: [], acceptance: ['可用'], verify: [] }],
      dependencies: [], qualityGates: [],
    },
    members: [{ memberId: 'worker', role: 'worker', sessionMode: 'persistent', sessionId: 'session-worker', provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [] }],
  },
};

const claim = (locator, extra = {}) => ({ kind: 'file', locator, ...extra });

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ant-audit-'));
  const context = new Context();
  context.provide('sessionController', { async prompt() { return { accepted: true }; }, async cancel() {} });
  const service = new AntService(context, { workspaceRoot, ownerId: 'audit-host' });
  t.after(async () => { await service.close(); await rm(workspaceRoot, { recursive: true, force: true }); });
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
  await writeFile(path.join(workspaceRoot, 'src', 'core.mjs'), 'export const core = 1;\n', 'utf8');
  const created = await service.dispatchAsOwner(request);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatchAsOwner({ requestId: 'confirm-audit', teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor });
  await service.dispatch({ requestId: 'dispatch-audit', teamId, action: 'attempt.dispatch', payload: { taskId: 'core', memberId: 'worker' } }, { actor: 'system', teamId });
  const started = await service.get({ teamId });
  const attemptId = started.attempts[0].attemptId;
  const complete = (evidence, requestId = 'complete-audit') => service.dispatch({ requestId, teamId, action: 'task.complete', payload: { taskId: 'core', attemptId, summary: '做完了', evidence } }, { actor: 'agent', teamId, memberId: 'worker', sessionId: 'session-worker' });
  return { service, teamId, workspaceRoot, complete };
}

test('a completion stamps the content digest of every workspace file it claims', async t => {
  const { service, teamId, complete } = await fixture(t);
  await complete([claim('src/core.mjs')]);
  const view = await service.get({ teamId });
  const stamped = view.attempts[0].completion.evidence[0];
  assert.equal(stamped.digest.length, 64);
  const audit = await service.auditArtifacts({ teamId });
  assert.equal(audit.ok, true);
  assert.equal(audit.findings[0].status, 'match');
});

test('an edit that keeps the byte count still reads as drift', async t => {
  const { service, teamId, workspaceRoot, complete } = await fixture(t);
  await complete([claim('src/core.mjs')]);
  await writeFile(path.join(workspaceRoot, 'src', 'core.mjs'), 'export const core = 2;\n', 'utf8');
  const audit = await service.auditArtifacts({ teamId });
  assert.equal(audit.ok, false);
  assert.equal(audit.drifted.length, 1);
  assert.notEqual(audit.drifted[0].actual, audit.drifted[0].expected);
});

test('a claimed digest that disagrees with the workspace stops the completion', async t => {
  const { service, teamId, complete } = await fixture(t);
  await assert.rejects(
    complete([claim('src/core.mjs', { digest: 'f'.repeat(64) })], 'complete-forged'),
    error => { assert.equal(error.code, 'team/invalid-state'); assert.match(error.message, /digest does not match/); return true; },
  );
  const view = await service.get({ teamId });
  assert.equal(view.attempts[0].completion, undefined);
  assert.equal(view.tasks[0].selfCompleted, undefined);
});

test('claiming a file that is not there stops the completion', async t => {
  const { service, complete } = await fixture(t);
  await assert.rejects(
    complete([claim('src/ghost.mjs')], 'complete-ghost'),
    error => { assert.equal(error.code, 'team/invalid-state'); assert.match(error.message, /file is missing/); return true; },
  );
});

test('a claim anchored outside the workspace is left as written', async t => {
  const { service, teamId, complete } = await fixture(t);
  await complete([claim('../escape.mjs')], 'complete-outside');
  const view = await service.get({ teamId });
  assert.equal(view.attempts[0].completion.evidence[0].digest, undefined);
  const audit = await service.auditArtifacts({ teamId });
  assert.equal(audit.findings[0].status, 'outside');
});
