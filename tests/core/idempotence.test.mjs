import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';
import { runSchedule } from '../../src/core/scheduler.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const member = (id, sessionId) => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] });
const task = id => ({ taskId: id, title: id, objective: id, inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'] });
const plan = (memberDelegation = false) => ({ planId: 'plan-1', mode: 'normal', maxActiveAttempts: 8, tasks: [task('task-1')], dependencies: [], qualityGates: [], ...(memberDelegation ? { memberDelegation: true } : {}) });

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-idem-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  return {
    service,
    create: (requestId, overrides = {}) => service.dispatch({
      requestId,
      action: 'team.create',
      payload: { goal: 'Refactor the panel', workspaceRelativePath: '.', plan: plan(options.memberDelegation), members: [member('member-1', 'session-1'), member('member-2', 'session-2')], ...overrides },
    }, user),
  };
}

const confirm = async (service, teamId, marker) => {
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: `confirm-${marker}`, teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
};

test('the same goal and task set never starts a second round', async t => {
  const { service, create } = await fixture(t);
  const first = await create('create-a');
  await confirm(service, first.teamId, 'a');
  await runSchedule({ service, teamId: first.teamId });
  const before = await service.get({ teamId: first.teamId });

  const second = await create('create-b');
  assert.equal(second.outcome, 'duplicate');
  assert.equal(second.teamId, first.teamId);
  assert.equal((await service.get({ teamId: first.teamId })).attempts.length, before.attempts.length);
  assert.equal((await service.list({})).teams.length, 1);
});

test('an explicit rerun starts a fresh team', async t => {
  const { service, create } = await fixture(t);
  const first = await create('create-a');
  await confirm(service, first.teamId, 'a');
  await runSchedule({ service, teamId: first.teamId });

  const rerun = await create('create-b', { rerun: true });
  assert.equal(rerun.outcome, 'committed');
  assert.notEqual(rerun.teamId, first.teamId);
  assert.equal((await service.list({})).teams.length, 2);
  assert.equal((await service.get({ teamId: rerun.teamId })).attempts.length, 0);
});

test('a different goal keeps its own team', async t => {
  const { service, create } = await fixture(t);
  const first = await create('create-a');
  const other = await service.dispatch({ requestId: 'create-c', action: 'team.create', payload: { goal: 'Ship the census', workspaceRelativePath: '.', plan: plan(), members: [member('member-1', 'session-1')] } }, user);
  assert.notEqual(other.teamId, first.teamId);
  assert.equal((await service.list({})).teams.length, 2);
});

test('a member cannot spawn a subagent unless delegation is allowed', async t => {
  const { service, create } = await fixture(t);
  const created = await create('create-a');
  await assert.rejects(
    service.dispatch({ requestId: 'delegate-1', teamId: created.teamId, action: 'member.invite', payload: { sessionId: 'session-9', role: 'helper', parentMemberId: 'member-1' } }, user),
    error => error.code === 'team/invalid-state' && /subagents/.test(error.message),
  );
});

test('one delegation level is allowed and the second is refused', async t => {
  const { service, create } = await fixture(t, { memberDelegation: true });
  const created = await create('create-a');
  const invited = await service.dispatch({ requestId: 'delegate-1', teamId: created.teamId, action: 'member.invite', payload: { sessionId: 'session-3', role: 'helper', parentMemberId: 'member-1' } }, user);
  assert.equal(invited.outcome, 'committed');

  const invitation = (await service.get({ teamId: created.teamId })).invitations.find(item => item.sessionId === 'session-3');
  assert.equal(invitation.depth, 1);

  await service.wal.appendInternal(created.teamId, [{
    type: 'member.accepted',
    payload: { invitationId: invitation.invitationId, member: { memberId: 'member-3', role: 'helper', sessionMode: 'persistent', sessionId: 'session-3', provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] } },
  }], 'seed-member-3');
  const helper = (await service.get({ teamId: created.teamId })).members.find(item => item.memberId === 'member-3');
  assert.equal(helper.depth, 1);

  await assert.rejects(
    service.dispatch({ requestId: 'delegate-2', teamId: created.teamId, action: 'member.invite', payload: { sessionId: 'session-4', role: 'helper', parentMemberId: 'member-3' } }, user),
    error => error.code === 'team/invalid-state' && /subagents/.test(error.message),
  );
});
