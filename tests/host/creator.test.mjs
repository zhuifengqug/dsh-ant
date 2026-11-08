import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { AntService } from '../../src/host/service.mjs';
import { createAntTools } from '../../src/host/tool.mjs';

const payload = (sessionId = 'session-lead') => ({
  goal: 'Open a colony from a Session',
  workspaceRelativePath: '.',
  plan: {
    planId: 'plan-creator', mode: 'normal', maxActiveAttempts: 2,
    tasks: [{ taskId: 'core', title: '实现', objective: '按规格实现', inScope: ['.'], outOfScope: [], acceptance: ['works'], verify: [] }],
    dependencies: [], qualityGates: [],
  },
  members: [{ memberId: 'member-1', role: 'queen', sessionMode: 'persistent', sessionId, provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [] }],
});

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ant-creator-'));
  const context = new Context();
  context.provide('sessionController', { async prompt() { return { accepted: true }; } });
  const service = new AntService(context, { workspaceRoot, ownerId: 'creator-host' });
  t.after(async () => { await service.close(); await rm(workspaceRoot, { recursive: true, force: true }); });
  const tools = createAntTools(service);
  const dispatch = tools.find(item => item.name === 'ant_team_dispatch');
  const release = tools.find(item => item.name === 'ant_team_release');
  return { service, dispatch, release };
}

const asAgent = sessionId => ({ agent: { session: { id: sessionId } } });

test('a Session opens its own colony and is seated as a member', async t => {
  const { dispatch, service } = await fixture(t);
  const created = await dispatch.execute({ request: { requestId: 'create-lead', action: 'team.create', payload: payload() } }, asAgent('session-lead'));
  assert.equal(created.outcome, 'committed');
  const view = await service.get({ teamId: created.teamId });
  assert.deepEqual(view.members.map(member => ({ memberId: member.memberId, sessionId: member.sessionId, status: member.status, origin: member.origin })), [
    { memberId: 'member-1', sessionId: 'session-lead', status: 'active', origin: 'existing' },
  ]);
});

test('one Session opens one colony', async t => {
  const { dispatch } = await fixture(t);
  await dispatch.execute({ request: { requestId: 'create-first', action: 'team.create', payload: payload() } }, asAgent('session-lead'));
  const second = await dispatch.execute({ request: { requestId: 'create-second', action: 'team.create', payload: payload() } }, asAgent('session-lead'));
  assert.equal(second.code, 'team/forbidden');
  assert.equal(second.message, 'This Session already belongs to a Team');
});

test('a lead seat takes the calling Session without naming it', async t => {
  const { dispatch, service } = await fixture(t);
  const request = payload('unused');
  const { sessionId, ...seat } = request.members[0];
  const members = [seat];
  const created = await dispatch.execute({ request: { requestId: 'create-lead-seat', action: 'team.create', payload: { ...request, members, leadMemberId: 'member-1' } } }, asAgent('session-lead'));
  assert.equal(created.outcome, 'committed');
  const view = await service.get({ teamId: created.teamId });
  assert.equal(view.members[0].sessionId, 'session-lead');
  assert.equal(view.members[0].status, 'active');
});

test('a lead seat must name a member of the roster', async t => {
  const { dispatch } = await fixture(t);
  const refused = await dispatch.execute({ request: { requestId: 'create-bad-lead', action: 'team.create', payload: { ...payload(), leadMemberId: 'member-9' } } }, asAgent('session-lead'));
  assert.equal(refused.code, 'team/forbidden');
  assert.equal(refused.message, 'Lead member is not in the roster');
});

test('a colony must seat the calling Session', async t => {
  const { dispatch } = await fixture(t);
  const refused = await dispatch.execute({ request: { requestId: 'create-absent', action: 'team.create', payload: payload('session-somebody-else') } }, asAgent('session-lead'));
  assert.equal(refused.code, 'team/forbidden');
  assert.equal(refused.message, 'Team creation must seat the calling Session as exactly one member');
});

test('release stays closed to a Session outside the roster', async t => {
  const { dispatch, release, service } = await fixture(t);
  const created = await dispatch.execute({ request: { requestId: 'create-lead', action: 'team.create', payload: payload() } }, asAgent('session-lead'));
  const refused = await release.execute({ teamId: created.teamId, taskIds: ['core'] }, asAgent('session-stranger'));
  assert.equal(refused.code, 'team/forbidden');
  assert.equal(refused.message, 'Calling agent is not an active Team member');
  assert.equal((await service.get({ teamId: created.teamId })).batches.length, 0);
});
