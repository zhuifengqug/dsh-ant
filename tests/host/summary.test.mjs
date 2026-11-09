import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { AntService } from '../../src/host/service.mjs';

const createPayload = {
  goal: 'Summarise the colony',
  workspaceRelativePath: '.',
  plan: {
    planId: 'plan-summary', mode: 'normal', maxActiveAttempts: 1,
    tasks: [{ taskId: 'summary-task', title: 'Summarise', objective: 'Summarise the colony', inScope: ['.'], outOfScope: [], acceptance: ['summary exists'], verify: ['node --test'] }],
    dependencies: [], qualityGates: [],
  },
  members: [
    { memberId: 'member-1', role: 'engineer', sessionMode: 'persistent', sessionId: 'session-1', provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [] },
    { memberId: 'member-2', role: 'reviewer', sessionMode: 'persistent', sessionId: 'session-2', provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [] },
  ],
};

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-summary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function settle(service, teamId, predicate) {
  for (let i = 0; i < 80; i++) {
    const view = await service.get({ teamId });
    if (predicate(view)) return view;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return service.get({ teamId });
}

test('summary counts unread mail until the recipient reads it', async t => {
  const root = await temporaryRoot(t);
  const context = new Context();
  context.provide('sessionController', { async prompt() { return { accepted: true }; } });
  const service = new AntService(context, { workspaceRoot: root, ownerId: 'summary-owner' });
  t.after(() => service.close());

  const created = await service.dispatchAsOwner({ requestId: 'summary-create', action: 'team.create', payload: createPayload });
  const teamId = created.teamId;
  const asMember1 = { session: { id: 'session-1' } };
  const asMember2 = { session: { id: 'session-2' } };

  await service.dispatchAsAgent({ requestId: 'summary-mail', teamId, action: 'mail.send', payload: { messageId: 'message-1', toMemberId: 'member-1', content: '你负责的那张票已经可以放行了', deliveryMode: 'queue' } }, asMember2);
  let view = await settle(service, teamId, candidate => candidate.mailbox[0]?.state === 'admitted');

  assert.equal(view.mailbox[0].state, 'admitted');
  assert.equal(view.summary.unread.total, 1);
  assert.equal(view.summary.unread.recent[0].messageId, 'message-1');
  assert.equal(view.summary.unread.recent[0].fromMemberId, 'member-2');
  assert.match(view.summary.unread.recent[0].excerpt, /可以放行/);

  await assert.rejects(
    service.dispatchAsAgent({ requestId: 'summary-peek', teamId, action: 'mail.read', payload: { messageId: 'message-1' } }, asMember2),
    error => error.code === 'team/forbidden' && /restricted to the recipient/.test(error.message),
  );

  await service.dispatchAsAgent({ requestId: 'summary-read', teamId, action: 'mail.read', payload: { messageId: 'message-1' } }, asMember1);
  view = await service.get({ teamId });
  assert.equal(view.summary.unread.total, 0);
  assert.deepEqual(view.summary.unread.recent, []);
  assert.equal(view.mailbox[0].state, 'read');
});
