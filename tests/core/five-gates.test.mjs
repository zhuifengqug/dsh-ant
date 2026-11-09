import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';
import { gateStatus, openIntegration, openReviews, pendingRelease } from '../../src/core/gate.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const member = (id, sessionId) => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] });
const asMember = (teamId, memberId, sessionId) => ({ actor: 'agent', teamId, memberId, sessionId });

const plan = {
  planId: 'five-1',
  mode: 'normal',
  maxActiveAttempts: 4,
  tasks: [{ taskId: 'core', title: '实现', objective: '按规格实现', inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'] }],
  dependencies: [],
  qualityGates: [
    { gateId: 'g-requirement', taskId: 'core', kind: 'requirement', acceptance: ['contract approved'] },
    { gateId: 'g-implementation', taskId: 'core', kind: 'implementation', acceptance: ['work recorded'] },
    { gateId: 'g-verification', taskId: 'core', kind: 'verification', acceptance: ['tests green'] },
    { gateId: 'g-review', taskId: 'core', kind: 'review', acceptance: ['peer review'] },
    { gateId: 'g-integration', taskId: 'core', kind: 'integration', acceptance: ['merged'] },
  ],
};

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-five-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const created = await service.dispatch({ requestId: 'create-1', action: 'team.create', payload: { goal: 'Five gates, one task', workspaceRelativePath: '.', leadMemberId: 'member-1', plan, members: [member('member-1', 'session-1'), member('member-2', 'session-2')] } }, user);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: 'confirm-1', teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  return { service, teamId };
}

const pending = async (service, teamId) => {
  const view = await service.get({ teamId });
  return { view, ids: gateStatus(view, view.plan, 'core').pending };
};

test('confirming the plan satisfies only the requirement gate', async t => {
  const { service, teamId } = await fixture(t);
  const { ids } = await pending(service, teamId);
  assert.deepEqual(ids, ['g-implementation', 'g-verification', 'g-review', 'g-integration']);
});

test('amending the contract after approval reopens the requirement gate', async t => {
  const { service, teamId } = await fixture(t);
  await service.dispatch({ requestId: 'amend-1', teamId, action: 'task.amend', payload: { taskId: 'core', patch: { acceptance: ['works offline'] }, reason: 'scope moved' } }, { actor: 'agent', teamId, memberId: 'member-1', sessionId: 'session-1' });
  const { ids } = await pending(service, teamId);
  assert.equal(ids[0], 'g-requirement');
});

test('the five gates settle in order and integration remains the last open one', async t => {
  const { service, teamId } = await fixture(t);
  await service.dispatch({ requestId: 'dispatch-1', teamId, action: 'attempt.dispatch', payload: { taskId: 'core', memberId: 'member-1' } }, { actor: 'system', teamId });
  const attemptId = (await service.get({ teamId })).attempts.at(-1).attemptId;

  await service.dispatch({ requestId: 'complete-1', teamId, action: 'task.complete', payload: { taskId: 'core', attemptId, summary: 'done', evidence: [{ kind: 'command', locator: 'node --test', note: 'green' }] } }, asMember(teamId, 'member-1', 'session-1'));
  let state = await pending(service, teamId);
  assert.deepEqual(state.ids, ['g-review', 'g-integration']);
  assert.deepEqual(openReviews(state.view, state.view.plan).map(item => ({ taskId: item.taskId, pendingGates: item.pendingGates })), [{ taskId: 'core', pendingGates: ['g-review', 'g-integration'] }]);

  await service.dispatch({ requestId: 'review-1', teamId, action: 'quality.review', payload: { taskId: 'core', attemptId, reviewerMemberId: 'member-2', verdict: 'pass', criteria: ['tests green'], summary: 'reads well', gateId: 'g-review' } }, asMember(teamId, 'member-2', 'session-2'));
  state = await pending(service, teamId);
  assert.deepEqual(state.ids, ['g-integration']);
  assert.deepEqual(pendingRelease(state.view, state.view.plan).map(item => item.taskId), ['core']);

  await service.dispatch({ requestId: 'release-1', teamId, action: 'batch.release', payload: { batchId: 'batch-1', taskIds: ['core'] } }, user);
  const released = await service.get({ teamId });
  assert.equal(released.tasks[0].state, 'released');
  assert.deepEqual(openIntegration(released, released.plan), [{ taskId: 'core', pendingGates: ['g-integration'] }]);

  await service.dispatch({ requestId: 'integrate-1', teamId, action: 'quality.review', payload: { taskId: 'core', attemptId, reviewerMemberId: 'member-2', verdict: 'pass', criteria: ['merged'], summary: 'shipped', gateId: 'g-integration' } }, asMember(teamId, 'member-2', 'session-2'));
  const shipped = await service.get({ teamId });
  assert.equal(shipped.tasks[0].state, 'released');
  assert.deepEqual(openIntegration(shipped, shipped.plan), []);
});

test('a released task refuses a work review but accepts an integration verdict', async t => {
  const { service, teamId } = await fixture(t);
  await service.dispatch({ requestId: 'dispatch-1', teamId, action: 'attempt.dispatch', payload: { taskId: 'core', memberId: 'member-1' } }, { actor: 'system', teamId });
  const attemptId = (await service.get({ teamId })).attempts.at(-1).attemptId;
  await service.dispatch({ requestId: 'complete-1', teamId, action: 'task.complete', payload: { taskId: 'core', attemptId, summary: 'done', evidence: [{ kind: 'command', locator: 'node --test' }] } }, asMember(teamId, 'member-1', 'session-1'));
  await service.dispatch({ requestId: 'review-1', teamId, action: 'quality.review', payload: { taskId: 'core', attemptId, reviewerMemberId: 'member-2', verdict: 'pass', criteria: ['tests green'], summary: 'ok', gateId: 'g-review' } }, asMember(teamId, 'member-2', 'session-2'));
  await service.dispatch({ requestId: 'release-1', teamId, action: 'batch.release', payload: { batchId: 'batch-1', taskIds: ['core'] } }, user);

  await assert.rejects(service.dispatch({ requestId: 'review-again', teamId, action: 'quality.review', payload: { taskId: 'core', attemptId, reviewerMemberId: 'member-2', verdict: 'pass', criteria: ['again'], summary: 'again', gateId: 'g-review' } }, asMember(teamId, 'member-2', 'session-2')), error => {
    assert.equal(error.code, 'team/invalid-state');
    assert.match(error.message, /closed for a released task/i);
    return true;
  });
  await service.dispatch({ requestId: 'integrate-1', teamId, action: 'quality.review', payload: { taskId: 'core', attemptId, reviewerMemberId: 'member-2', verdict: 'pass', criteria: ['merged'], summary: 'shipped', gateId: 'g-integration' } }, asMember(teamId, 'member-2', 'session-2'));
  assert.deepEqual(openIntegration(await service.get({ teamId }), (await service.get({ teamId })).plan), []);
});
