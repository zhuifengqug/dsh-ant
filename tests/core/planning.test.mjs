import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';
import { gateStatus, pendingRelease, taskCoverage } from '../../src/core/gate.mjs';
import { evaluateSchedule, runSchedule } from '../../src/core/scheduler.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const operator = teamId => ({ actor: 'agent', teamId, memberId: 'member-1', sessionId: 'session-1' });
const worker = teamId => ({ actor: 'agent', teamId, memberId: 'member-2', sessionId: 'session-2' });
const member = (id, sessionId) => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] });
const task = (id, owner) => ({ taskId: id, title: id, objective: id, ownerMemberId: owner, inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'] });
const evidence = [{ kind: 'command', locator: 'node --test', note: 'green' }];

async function rejects(run, code, needle) {
  await assert.rejects(run, error => {
    assert.equal(error.code, code);
    if (needle) assert.match(error.message, needle);
    return true;
  });
}

const gate = (taskId) => ({ gateId: 'gate-' + taskId, taskId, kind: 'verification', acceptance: ['node --test is green'] });

function planOf(tasks, dependencies = []) {
  return { planId: 'plan-1', mode: 'normal', maxActiveAttempts: 8, tasks, dependencies, qualityGates: tasks.map(item => gate(item.taskId)) };
}

async function fixture(t, tag, { confirm = true, tasks = [task('task-1', 'member-1'), task('task-2', 'member-2')], dependencies = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-planning-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const plan = planOf(tasks, dependencies);
  const created = await service.dispatch({
    requestId: 'create-' + tag,
    action: 'team.create',
    payload: { goal: 'Grow the colony while it runs', workspaceRelativePath: '.', leadMemberId: 'member-1', plan, members: [member('member-1', 'session-1'), member('member-2', 'session-2'), member('member-3', 'session-3')] },
  }, user);
  const teamId = created.teamId;
  if (confirm) {
    const view = await service.get({ teamId });
    await service.dispatch({ requestId: 'confirm-' + tag, teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  }
  return { service, teamId };
}

test('a staged plan is amended before confirmation and the digest follows', async t => {
  const { service, teamId } = await fixture(t, 'staged', { confirm: false });
  const staged = await service.get({ teamId });
  assert.equal(staged.planState, 'staged');

  const grown = { ...staged.plan, tasks: [...staged.plan.tasks, task('task-3', 'member-3')], qualityGates: [...staged.plan.qualityGates, gate('task-3')] };
  const amended = await service.dispatch({ requestId: 'amend-staged', teamId, action: 'plan.amend', payload: { plan: grown, reason: 'add the third lane' } }, operator(teamId));
  assert.equal(amended.outcome, 'committed');

  const view = await service.get({ teamId });
  assert.equal(view.planState, 'staged');
  assert.notEqual(view.planDigest, staged.planDigest);
  assert.equal(view.planRevisions.length, 1);
  assert.equal(view.planRevisions[0].previousDigest, staged.planDigest);
  assert.equal(view.tasks.length, 3);

  await rejects(service.dispatch({ requestId: 'stale-confirm', teamId, action: 'plan.confirm', payload: { planDigest: staged.planDigest } }, user), 'team/invalid-state', /digest/i);
  await service.dispatch({ requestId: 'fresh-confirm', teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest } }, user);
  assert.equal((await service.get({ teamId })).planState, 'confirmed');
});

test('the lead grows a running colony and the new task waits for its dependency', async t => {
  const { service, teamId } = await fixture(t, 'grow');
  await runSchedule({ service, teamId });
  const running = await service.get({ teamId });
  assert.equal(running.tasks.find(item => item.taskId === 'task-1').state, 'running');

  await service.dispatch({
    requestId: 'create-downstream',
    teamId,
    action: 'task.create',
    payload: { task: task('task-3', 'member-3'), dependencies: [{ taskId: 'task-3', blockedByTaskId: 'task-1' }], qualityGates: [gate('task-3')], reason: 'the migration needs a verifier' },
  }, operator(teamId));

  const view = await service.get({ teamId });
  assert.equal(view.tasks.find(item => item.taskId === 'task-3').state, 'pending');
  assert.equal(view.taskRevisions.at(-1).taskId, 'task-3');
  assert.equal(view.plan.tasks.length, 3);
  assert.equal(view.coverage.counts.total, 3);
  assert.equal(view.coverage.tasks.find(item => item.taskId === 'task-3').ownerBound, true);

  const plan = evaluateSchedule(view);
  assert.equal(plan.ready.includes('task-3'), false);
  await rejects(service.dispatch({ requestId: 'duplicate-task', teamId, action: 'task.create', payload: { task: task('task-3', 'member-3') } }, operator(teamId)), 'team/invalid-state', /identity/i);
});

test('amending a contract reopens the gate and supersedes the stale attempt', async t => {
  const { service, teamId } = await fixture(t, 'amend');
  await runSchedule({ service, teamId });
  const started = await service.get({ teamId });
  const first = started.attempts.find(item => item.taskId === 'task-1');
  await service.dispatch({ requestId: 'complete-1', teamId, action: 'task.complete', payload: { taskId: 'task-1', attemptId: first.attemptId, summary: 'done', evidence } }, operator(teamId));

  const completed = await service.get({ teamId });
  assert.deepEqual(gateStatus(completed, completed.plan, 'task-1').pending, []);
  assert.deepEqual(taskCoverage(completed, completed.plan).tasks.find(item => item.taskId === 'task-1').pendingGates, []);

  await service.dispatch({
    requestId: 'amend-verify',
    teamId,
    action: 'task.amend',
    payload: { taskId: 'task-1', patch: { verify: ['node --test tests/core/gate.test.mjs'] }, reason: 'cover the gate path' },
  }, operator(teamId));

  const amended = await service.get({ teamId });
  const reopened = amended.tasks.find(item => item.taskId === 'task-1');
  assert.equal(reopened.selfCompleted, false);
  assert.equal(reopened.state, 'pending');
  assert.deepEqual(reopened.verify, ['node --test tests/core/gate.test.mjs']);
  assert.equal(amended.attempts.find(item => item.attemptId === first.attemptId).state, 'superseded');
  assert.deepEqual(taskCoverage(amended, amended.plan).tasks.find(item => item.taskId === 'task-1').pendingGates, ['gate-task-1']);
  assert.deepEqual(gateStatus(amended, amended.plan, 'task-1').pending, ['gate-task-1']);

  const tick = await runSchedule({ service, teamId });
  assert.equal(tick.dispatched.some(item => item.taskId === 'task-1'), true);
  const restarted = await service.get({ teamId });
  const attempts = restarted.attempts.filter(item => item.taskId === 'task-1');
  assert.equal(attempts.length, 2);
  assert.equal(attempts.at(-1).state, 'running');
});

test('reassignment waits for the running executor to settle', async t => {
  const { service, teamId } = await fixture(t, 'reassign');
  await runSchedule({ service, teamId });
  const view = await service.get({ teamId });
  const attempt = view.attempts.find(item => item.taskId === 'task-1');

  await rejects(service.dispatch({ requestId: 'move-busy', teamId, action: 'task.reassign', payload: { taskId: 'task-1', memberId: 'member-2' } }, operator(teamId)), 'team/invalid-state', /settling/i);
  await service.dispatch({ requestId: 'terminate-1', teamId, action: 'attempt.terminate', payload: { taskId: 'task-1', attemptId: attempt.attemptId, reason: 'hand it over' } }, user);
  await service.dispatch({ requestId: 'move-free', teamId, action: 'task.reassign', payload: { taskId: 'task-1', memberId: 'member-2', reason: 'member-1 is saturated' } }, operator(teamId));

  const moved = await service.get({ teamId });
  assert.equal(moved.tasks.find(item => item.taskId === 'task-1').ownerMemberId, 'member-2');
  assert.equal(moved.plan.tasks.find(item => item.taskId === 'task-1').ownerMemberId, 'member-2');
  await rejects(service.dispatch({ requestId: 'move-ghost', teamId, action: 'task.reassign', payload: { taskId: 'task-1', memberId: 'member-9' } }, operator(teamId)), 'team/invalid-state', /member/i);
});

test('halting the colony pauses every open attempt and the tick stands down', async t => {
  const { service, teamId } = await fixture(t, 'halt');
  await runSchedule({ service, teamId });
  const running = await service.get({ teamId });
  assert.equal(running.attempts.filter(item => item.state === 'running').length, 2);

  await service.dispatch({ requestId: 'halt-1', teamId, action: 'team.halt', payload: { reason: 'freeze the line' } }, operator(teamId));
  const halted = await service.get({ teamId });
  assert.equal(halted.halted, true);
  assert.equal(halted.haltReason, 'freeze the line');
  assert.equal(halted.attempts.every(item => item.state === 'paused'), true);
  assert.equal(halted.tasks.every(item => item.state === 'paused'), true);
  assert.deepEqual(pendingRelease(halted), []);

  const plan = evaluateSchedule(halted);
  assert.equal(plan.halted, true);
  assert.deepEqual(plan.assigns, []);
  const tick = await runSchedule({ service, teamId });
  assert.deepEqual(tick.dispatched, []);
  await rejects(service.dispatch({ requestId: 'halt-twice', teamId, action: 'team.halt', payload: {} }, operator(teamId)), 'team/invalid-state', /halted/i);
  await rejects(service.dispatch({ requestId: 'dispatch-halted', teamId, action: 'attempt.dispatch', payload: { taskId: 'task-2', memberId: 'member-2' } }, { actor: 'system', teamId }), 'team/invalid-state', /halted/i);

  await service.dispatch({ requestId: 'resume-1', teamId, action: 'team.resume', payload: {} }, operator(teamId));
  const resumed = await service.get({ teamId });
  assert.equal(resumed.halted, false);
  assert.equal(resumed.haltReason, null);
  assert.equal(resumed.attempts.filter(item => item.state === 'running').length, 2);
  await rejects(service.dispatch({ requestId: 'resume-twice', teamId, action: 'team.resume', payload: {} }, operator(teamId)), 'team/invalid-state', /not halted/i);
});

test('growing or halting the colony is the lead\'s call', async t => {
  const { service, teamId } = await fixture(t, 'authority');
  await runSchedule({ service, teamId });
  await rejects(service.dispatch({ requestId: 'worker-create', teamId, action: 'task.create', payload: { task: task('task-9', 'member-2') } }, worker(teamId)), 'team/forbidden', /colony lead/i);
  await rejects(service.dispatch({ requestId: 'worker-halt', teamId, action: 'team.halt', payload: {} }, worker(teamId)), 'team/forbidden', /colony lead/i);
  await rejects(service.dispatch({ requestId: 'worker-amend', teamId, action: 'task.amend', payload: { taskId: 'task-1', patch: { verify: ['true'] }, reason: 'shrink the check' } }, worker(teamId)), 'team/forbidden', /colony lead/i);
  await service.dispatch({ requestId: 'owner-halt', teamId, action: 'team.halt', payload: {} }, user);
  assert.equal((await service.get({ teamId })).halted, true);
});
