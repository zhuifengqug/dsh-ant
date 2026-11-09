import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const member = (id, sessionId, extra = {}) => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [], ...extra });
const task = id => ({ taskId: id, title: id, objective: id, ownerMemberId: 'member-1', inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'] });
const gate = taskId => ({ gateId: 'gate-' + taskId, taskId, kind: 'verification', acceptance: ['node --test is green'] });

async function rejects(run, code, needle) {
  await assert.rejects(run, error => {
    assert.equal(error.code, code);
    if (needle) assert.match(error.message, needle);
    return true;
  });
}

async function fixture(t, tag, members) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-fallback-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const tasks = [task('task-1')];
  const created = await service.dispatch({
    requestId: 'create-' + tag,
    action: 'team.create',
    payload: { goal: 'Survive a provider failure', workspaceRelativePath: '.', leadMemberId: 'member-1', plan: { planId: 'plan-1', mode: 'normal', maxActiveAttempts: 8, tasks, dependencies: [], qualityGates: tasks.map(item => gate(item.taskId)) }, members },
  }, user);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: 'confirm-' + tag, teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  return { service, teamId };
}

async function running(service, teamId, suffix) {
  await service.dispatch({ requestId: 'dispatch-' + suffix, teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-1' } }, { actor: 'system', teamId });
  const view = await service.get({ teamId });
  return view.attempts.at(-1).attemptId;
}

async function interrupt(service, teamId, suffix, attemptId, kind) {
  return service.dispatch({ requestId: 'break-' + suffix, teamId, action: 'run.interrupted', payload: { reason: 'provider rejected the request', kind, taskId: 'task-1', attemptId } }, { actor: 'system', teamId });
}

const spare = { fallback: { provider: 'anthropic', model: 'claude-sonnet-4.6', reasoningEffort: 'low' } };

test('a provider failure falls back to the spare model without losing the task', async t => {
  const { service, teamId } = await fixture(t, 'ok', [member('member-1', 'session-1', spare)]);
  const first = await running(service, teamId, 'one');
  await interrupt(service, teamId, 'one', first, 'error');

  const view = await service.get({ teamId });
  assert.equal(view.attempts[0].interruption.kind, 'error');
  assert.equal(view.tasks[0].state, 'failed');

  await service.dispatch({ requestId: 'fallback-ok', teamId, action: 'attempt.fallback', payload: { taskId: 'task-1', previousAttemptId: first, memberId: 'member-1' } }, { actor: 'system', teamId });
  const fallbackView = await service.get({ teamId });
  const next = fallbackView.attempts.at(-1);
  assert.equal(next.state, 'running');
  assert.equal(next.provider, 'anthropic');
  assert.equal(next.model, 'claude-sonnet-4.6');
  assert.equal(next.reasoningEffort, 'low');
  assert.equal(next.fallbackOf, first);
  assert.equal(next.generation, 2);
  assert.equal(fallbackView.tasks[0].state, 'running');
});

test('only a provider failure falls back', async t => {
  const { service, teamId } = await fixture(t, 'kind', [member('member-1', 'session-1', spare)]);
  const first = await running(service, teamId, 'one');
  await interrupt(service, teamId, 'one', first, 'output-limit');
  await rejects(service.dispatch({ requestId: 'fallback-kind', teamId, action: 'attempt.fallback', payload: { taskId: 'task-1', previousAttemptId: first, memberId: 'member-1' } }, { actor: 'system', teamId }), 'team/invalid-state', /provider run/i);
});

test('a member without a spare model cannot fall back', async t => {
  const { service, teamId } = await fixture(t, 'bare', [member('member-1', 'session-1')]);
  const first = await running(service, teamId, 'one');
  await interrupt(service, teamId, 'one', first, 'error');
  await rejects(service.dispatch({ requestId: 'fallback-bare', teamId, action: 'attempt.fallback', payload: { taskId: 'task-1', previousAttemptId: first, memberId: 'member-1' } }, { actor: 'system', teamId }), 'team/invalid-state', /no fallback model/i);
});

test('the spare model must differ from the failed one', async t => {
  const { service, teamId } = await fixture(t, 'same', [member('member-1', 'session-1', { fallback: { provider: 'deepseek', model: 'deepseek-v4' } })]);
  const first = await running(service, teamId, 'one');
  await interrupt(service, teamId, 'one', first, 'error');
  await rejects(service.dispatch({ requestId: 'fallback-same', teamId, action: 'attempt.fallback', payload: { taskId: 'task-1', previousAttemptId: first, memberId: 'member-1' } }, { actor: 'system', teamId }), 'team/invalid-state', /repeats the failed one/i);
});

test('the fallback attempt is the one that can be reviewed and released', async t => {
  const { service, teamId } = await fixture(t, 'chain', [member('member-1', 'session-1', spare), member('member-2', 'session-2')]);
  const first = await running(service, teamId, 'one');
  await interrupt(service, teamId, 'one', first, 'error');
  await service.dispatch({ requestId: 'fallback-chain', teamId, action: 'attempt.fallback', payload: { taskId: 'task-1', previousAttemptId: first, memberId: 'member-1' } }, { actor: 'system', teamId });
  const second = (await service.get({ teamId })).attempts.at(-1).attemptId;

  await service.dispatch({ requestId: 'complete-chain', teamId, action: 'task.complete', payload: { taskId: 'task-1', attemptId: second, summary: 'done on the spare model', evidence: [{ kind: 'command', locator: 'node --test', note: 'green' }] } }, { actor: 'agent', teamId, memberId: 'member-1', sessionId: 'session-1' });
  await service.dispatch({ requestId: 'review-chain', teamId, action: 'quality.review', payload: { taskId: 'task-1', attemptId: second, reviewerMemberId: 'member-2', criteria: ['node --test is green'], summary: 'spare-model run is green', verdict: 'pass' } }, { actor: 'agent', teamId, memberId: 'member-2', sessionId: 'session-2' });
  assert.equal((await service.get({ teamId })).tasks[0].state, 'reviewed');
  await rejects(service.dispatch({ requestId: 'stale-review', teamId, action: 'task.complete', payload: { taskId: 'task-1', attemptId: first, summary: 'stale', evidence: [{ kind: 'command', locator: 'node --test' }] } }, { actor: 'agent', teamId, memberId: 'member-1', sessionId: 'session-1' }), 'team/invalid-state');
});
