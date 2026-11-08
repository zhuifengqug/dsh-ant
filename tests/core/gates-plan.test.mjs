import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';
import { blockedRelease, gateStatus, openIntegration, pendingRelease } from '../../src/core/gate.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const member = (id, sessionId) => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] });
const asMember = (teamId, memberId, sessionId) => ({ actor: 'agent', teamId, memberId, sessionId });
const plan = {
  planId: 'gated-1',
  mode: 'normal',
  maxActiveAttempts: 4,
  tasks: [{ taskId: 'core', title: '实现', objective: '按规格实现', inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test', 'npm run lint'] }],
  dependencies: [],
  qualityGates: [
    { gateId: 'core-verification', taskId: 'core', kind: 'verification', acceptance: ['works'] },
    { gateId: 'core-review-a', taskId: 'core', kind: 'review', acceptance: ['peer review'] },
    { gateId: 'core-review-b', taskId: 'core', kind: 'review', acceptance: ['second reader'] },
    { gateId: 'ship-integration', taskId: 'core', kind: 'integration', acceptance: ['merged'] },
  ],
};

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-gates-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const created = await service.dispatch({ requestId: 'create-1', action: 'team.create', payload: { goal: 'Gate the plan', workspaceRelativePath: '.', plan, members: [member('member-1', 'session-1'), member('member-2', 'session-2')] } }, user);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: 'confirm-1', teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  await service.dispatch({ requestId: 'dispatch-1', teamId, action: 'attempt.dispatch', payload: { taskId: 'core', memberId: 'member-1' } }, { actor: 'system', teamId });
  const attemptId = (await service.get({ teamId })).attempts.at(-1).attemptId;
  return { service, teamId, attemptId };
}

const complete = (service, teamId, attemptId, evidence, requestId) => service.dispatch({ requestId, teamId, action: 'task.complete', payload: { taskId: 'core', attemptId, summary: 'done', evidence } }, asMember(teamId, 'member-1', 'session-1'));
const review = (service, teamId, attemptId, payload, requestId) => service.dispatch({ requestId, teamId, action: 'quality.review', payload: { taskId: 'core', attemptId, reviewerMemberId: 'member-2', verdict: 'pass', criteria: ['works'], summary: 'peer', ...payload } }, asMember(teamId, 'member-2', 'session-2'));

test('completion must present evidence for every verify command', async t => {
  const { service, teamId, attemptId } = await fixture(t);
  await assert.rejects(
    complete(service, teamId, attemptId, [{ kind: 'command', locator: 'node --test', note: 'green' }], 'complete-1'),
    error => error.code === 'team/invalid-state' && /missing verify evidence: npm run lint/.test(error.message),
  );
  await complete(service, teamId, attemptId, [{ kind: 'command', locator: 'node --test', note: 'green' }, { kind: 'command', locator: 'npm run lint --silent', note: 'clean' }], 'complete-2');
  const view = await service.get({ teamId });
  assert.equal(view.tasks[0].selfCompleted, true);
  assert.deepEqual(gateStatus(view, view.plan, 'core').pending, ['core-review-a', 'core-review-b', 'ship-integration']);
});

test('release waits for every declared review gate and integration waits for the merge', async t => {
  const { service, teamId, attemptId } = await fixture(t);
  await complete(service, teamId, attemptId, [{ kind: 'command', locator: 'node --test', note: 'green' }, { kind: 'command', locator: 'npm run lint', note: 'clean' }], 'complete-1');
  await review(service, teamId, attemptId, { gateId: 'core-review-a' }, 'review-a');
  let view = await service.get({ teamId });
  assert.equal(view.tasks[0].state, 'reviewed');
  assert.deepEqual(pendingRelease(view, view.plan), []);
  assert.deepEqual(blockedRelease(view, view.plan), [{ taskId: 'core', pendingGates: ['core-review-b'] }]);

  await review(service, teamId, attemptId, { gateId: 'core-review-b' }, 'review-b');
  view = await service.get({ teamId });
  assert.deepEqual(pendingRelease(view, view.plan).map(item => item.taskId), ['core']);
  assert.deepEqual(blockedRelease(view, view.plan), []);

  const released = await service.dispatch({ requestId: 'release-1', teamId, action: 'batch.release', payload: { batchId: 'batch-1', taskIds: ['core'] }, expectedEventSeq: view.cursor }, user);
  assert.equal(released.outcome, 'committed');
  view = await service.get({ teamId });
  assert.deepEqual(openIntegration(view, view.plan), [{ taskId: 'core', pendingGates: ['ship-integration'] }]);
});

test('a plan gate cannot be smuggled: review and completion both query declared gates', async t => {
  const { service, teamId, attemptId } = await fixture(t);
  await complete(service, teamId, attemptId, [{ kind: 'command', locator: 'node --test', note: 'green' }, { kind: 'command', locator: 'npm run lint', note: 'clean' }], 'complete-1');
  await assert.rejects(
    review(service, teamId, attemptId, { gateId: 'ship-integration' }, 'review-wrong-kind'),
    error => error.code === 'team/invalid-state' && /does not belong to this task/.test(error.message),
  );
  await assert.rejects(
    review(service, teamId, attemptId, { gateId: 'core-verification' }, 'review-wrong-gate'),
    error => error.code === 'team/invalid-state' && /does not belong to this task/.test(error.message),
  );
  await assert.rejects(
    review(service, teamId, attemptId, {}, 'review-unnamed'),
    error => error.code === 'team/invalid-state' && /name its gate/.test(error.message),
  );
});

test('the view carries the panel queues so the client never re-derives a gate', async t => {
  const { service, teamId, attemptId } = await fixture(t);
  await complete(service, teamId, attemptId, [{ kind: 'command', locator: 'node --test', note: 'green' }, { kind: 'command', locator: 'npm run lint', note: 'clean' }], 'complete-1');
  await review(service, teamId, attemptId, { gateId: 'core-review-a' }, 'review-a');
  const view = await service.get({ teamId });
  assert.deepEqual(view.releaseQueue, []);
  assert.deepEqual(view.blockedRelease, [{ taskId: 'core', pendingGates: ['core-review-b'] }]);
  assert.deepEqual(view.integrationQueue, []);

  await review(service, teamId, attemptId, { gateId: 'core-review-b' }, 'review-b');
  const ready = await service.get({ teamId });
  assert.deepEqual(ready.releaseQueue.map(item => item.taskId), ['core']);
  assert.deepEqual(ready.blockedRelease, []);
});
