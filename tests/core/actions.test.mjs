import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';

const createPayload = {
  goal: 'Ship repository change',
  workspaceRelativePath: '.',
  plan: {
    planId: 'plan-1', mode: 'normal', maxActiveAttempts: 2,
    tasks: [{ taskId: 'task-1', title: 'Implement', objective: 'Implement core', inScope: ['src'], outOfScope: ['dist'], acceptance: ['works'], verify: ['node --test'], ownerMemberId: 'member-1' }],
    dependencies: [], qualityGates: [{ gateId: 'gate-1', taskId: 'task-1', kind: 'verification', acceptance: ['tests pass'] }],
  },
  members: [{ memberId: 'member-1', role: 'engineer', sessionMode: 'persistent', sessionId: 'session-1', provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: ['dist'] }],
};
const user = { actor: 'user', principal: { kind: 'owner' } };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-actions-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  return { service, root };
}

test('create commits a stable TeamView, duplicate returns original teamId, and list is host-rooted', async t => {
  const { service } = await fixture(t);
  const request = { requestId: 'create-1', action: 'team.create', payload: createPayload };
  const first = await service.dispatch(request, user);
  const duplicate = await service.dispatch(request, user);
  assert.equal(first.outcome, 'committed');
  assert.equal(duplicate.outcome, 'duplicate');
  assert.equal(duplicate.teamId, first.teamId);
  const repeated = await service.dispatch({ ...request, requestId: 'create-agent' }, { actor: 'agent', teamId: first.teamId, memberId: 'member-1', sessionId: 'session-1' });
  assert.equal(repeated.outcome, 'duplicate');
  assert.equal(repeated.teamId, first.teamId);
  assert.equal((await service.get({ teamId: first.teamId })).cursor, 1);
  const view = await service.get({ teamId: first.teamId });
  assert.equal(view.lifecycle, 'staged');
  assert.equal(view.cursor, 1);
  assert.equal(view.members[0].sessionId, 'session-1');
  const list = await service.list({});
  assert.deepEqual(list.teams.map(team => team.teamId), [first.teamId]);
  await assert.rejects(service.list({ workspaceRoot: 'C:\\outside' }), { code: 'team/invalid-action' });
});

test('plan confirmation and dispatch enforce owner authority, CAS, dependencies, and task ownership', async t => {
  const { service } = await fixture(t);
  const created = await service.dispatch({ requestId: 'create-2', action: 'team.create', payload: createPayload }, user);
  await assert.rejects(service.dispatch({ requestId: 'dispatch-before-plan', teamId: created.teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-1' }, expectedEventSeq: 1 }, { actor: 'system', teamId: created.teamId }), { code: 'team/forbidden' });
  const confirmed = await service.dispatch({ requestId: 'confirm-2', teamId: created.teamId, action: 'plan.confirm', payload: { planDigest: (await service.get({ teamId: created.teamId })).planDigest }, expectedEventSeq: 1 }, user);
  assert.equal(confirmed.outcome, 'committed');
  const dispatched = await service.dispatch({ requestId: 'dispatch-2', teamId: created.teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-1' }, expectedEventSeq: 2 }, { actor: 'system', teamId: created.teamId });
  assert.equal(dispatched.outcome, 'committed');
  await assert.rejects(service.dispatch({ requestId: 'stale-2', teamId: created.teamId, action: 'attempt.pause', payload: { taskId: 'task-1', attemptId: 'attempt-1' }, expectedEventSeq: 2 }, user), { code: 'team/stale-cursor' });
  const view = await service.get({ teamId: created.teamId });
  assert.equal(view.attempts.length, 1);
  assert.equal(view.attempts[0].state, 'running');
});

test('member authority is bound to the invited session and cannot execute user actions', async t => {
  const { service } = await fixture(t);
  const created = await service.dispatch({ requestId: 'create-3', action: 'team.create', payload: createPayload }, user);
  await assert.rejects(service.dispatch({ requestId: 'confirm-3', teamId: created.teamId, action: 'plan.confirm', payload: { planDigest: (await service.get({ teamId: created.teamId })).planDigest } }, { actor: 'agent', teamId: created.teamId, memberId: 'member-1', sessionId: 'session-1' }), { code: 'team/forbidden' });
  await assert.rejects(service.dispatch({ requestId: 'change-3', teamId: created.teamId, action: 'member.changeModel', payload: { memberId: 'member-1', provider: 'openai', model: 'gpt-5.6' } }, { actor: 'agent', teamId: created.teamId, memberId: 'member-1', sessionId: 'session-1' }), { code: 'team/forbidden' });
});

test('delete removes the team record and a later delete is an explicit not-found state', async t => {
  const { service } = await fixture(t);
  const created = await service.dispatch({ requestId: 'create-4', action: 'team.create', payload: createPayload }, user);
  const deleted = await service.dispatch({ requestId: 'delete-4', teamId: created.teamId, action: 'team.delete', payload: {} }, user);
  assert.equal(deleted.outcome, 'committed');
  assert.equal(deleted.deletion, 'removed');
  await assert.rejects(service.get({ teamId: created.teamId }), { code: 'team/not-found' });
  await assert.rejects(service.dispatch({ requestId: 'other-delete-4', teamId: created.teamId, action: 'team.delete', payload: {} }, user), { code: 'team/not-found' });
});

test('mail admission mutates one queued message through the same WAL and is idempotent', async t => {
  const { service } = await fixture(t);
  const created = await service.dispatch({ requestId: 'mail-create-1', action: 'team.create', payload: createPayload }, user);
  const queued = await service.dispatch({
    requestId: 'mail-send-1', teamId: created.teamId, action: 'mail.send',
    payload: { messageId: 'message-1', toMemberId: 'member-1', content: 'queue work', deliveryMode: 'queue' },
  }, user);
  assert.equal(queued.firstEventSeq, 2);
  let view = await service.get({ teamId: created.teamId });
  assert.deepEqual({ state: view.mailbox[0].state, toSessionId: view.mailbox[0].toSessionId }, { state: 'queued', toSessionId: 'session-1' });

  const admitted = await service.admitMail({ teamId: created.teamId, messageId: 'message-1', sessionId: 'session-1', deliveryMode: 'queue', accepted: true });
  assert.equal(admitted.outcome, 'committed');
  assert.equal(admitted.firstEventSeq, 3);
  view = await service.get({ teamId: created.teamId });
  assert.equal(view.cursor, 3);
  assert.equal(view.mailbox.length, 1);
  assert.equal(view.mailbox[0].state, 'admitted');
  assert.deepEqual(view.mailbox[0].receipts.map(item => item.stage), ['admitted']);

  const duplicate = await service.admitMail({ teamId: created.teamId, messageId: 'message-1', sessionId: 'session-1', deliveryMode: 'queue', accepted: true });
  assert.equal(duplicate.outcome, 'duplicate');
  assert.equal((await service.get({ teamId: created.teamId })).cursor, 3);
  await assert.rejects(service.admitMail({ teamId: created.teamId, messageId: 'message-1', sessionId: 'other-session', deliveryMode: 'queue', accepted: true }), { code: 'team/duplicate-request-conflict' });

  const pending = await service.dispatch({
    requestId: 'mail-send-2', teamId: created.teamId, action: 'mail.send',
    payload: { messageId: 'message-2', toMemberId: 'member-1', content: 'stale recipient', deliveryMode: 'queue' },
  }, user);
  assert.equal(pending.outcome, 'committed');
  await service.dispatch({ requestId: 'member-remove-mail', teamId: created.teamId, action: 'member.remove', payload: { memberId: 'member-1' } }, user);
  await assert.rejects(service.admitMail({ teamId: created.teamId, messageId: 'message-2', sessionId: 'session-1', deliveryMode: 'queue', accepted: true }), { code: 'team/forbidden' });
});
