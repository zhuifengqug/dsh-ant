import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const member = (id, sessionId) => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] });
const asMember = (teamId, memberId, sessionId) => ({ actor: 'agent', teamId, memberId, sessionId });
const system = teamId => ({ actor: 'system', teamId });

const plan = {
  planId: 'summary-1',
  mode: 'normal',
  maxActiveAttempts: 4,
  tasks: [{ taskId: 'core', title: '实现', objective: '按规格实现', inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'], ownerMemberId: 'member-2' }],
  dependencies: [],
  qualityGates: [{ gateId: 'g-review', taskId: 'core', kind: 'review', acceptance: ['peer review'] }],
};

async function fixture(t, { confirm = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-summary-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const created = await service.dispatch({ requestId: 'create-1', action: 'team.create', payload: { goal: 'Knot the colony summary', workspaceRelativePath: '.', leadMemberId: 'member-1', plan, members: [member('member-1', 'session-1'), member('member-2', 'session-2')] } }, user);
  const teamId = created.teamId;
  if (confirm) {
    const view = await service.get({ teamId });
    await service.dispatch({ requestId: 'confirm-1', teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  }
  return { service, teamId };
}

test('the summary reports the colony after every gate settles', async t => {
  const { service, teamId } = await fixture(t);
  let view = await service.get({ teamId });
  assert.equal(view.summary.planState, 'confirmed');
  assert.equal(view.summary.halted, false);
  assert.deepEqual(view.summary.released, []);
  assert.equal(view.summary.lastBatch, null);
  assert.equal(view.summary.counts.total, 1);

  await service.dispatch({ requestId: 'dispatch-1', teamId, action: 'attempt.dispatch', payload: { taskId: 'core', memberId: 'member-2' } }, system(teamId));
  view = await service.get({ teamId });
  assert.deepEqual(view.summary.open.map(item => [item.memberId, item.state]), [['member-2', 'running']]);
  const attemptId = view.attempts.at(-1).attemptId;

  await service.dispatch({ requestId: 'complete-1', teamId, action: 'task.complete', payload: { taskId: 'core', attemptId, summary: 'done', evidence: [{ kind: 'command', locator: 'node --test', note: 'green' }] } }, asMember(teamId, 'member-2', 'session-2'));
  await service.dispatch({ requestId: 'review-1', teamId, action: 'quality.review', payload: { taskId: 'core', attemptId, reviewerMemberId: 'member-1', verdict: 'pass', criteria: ['reads well'], summary: 'ok', gateId: 'g-review' } }, asMember(teamId, 'member-1', 'session-1'));
  await service.dispatch({ requestId: 'release-1', teamId, action: 'batch.release', payload: { batchId: 'batch-1', taskIds: ['core'] } }, user);

  view = await service.get({ teamId });
  assert.deepEqual(view.summary.released, ['core']);
  assert.deepEqual(view.summary.open, []);
  assert.equal(view.summary.counts.released, 1);
  assert.equal(view.summary.lastBatch.batchId, 'batch-1');
  assert.deepEqual(view.summary.lastBatch.taskIds, ['core']);
  assert.equal(view.summary.lifecycle, 'running');
});

test('the summary counts unread mail and names the lead backlog', async t => {
  const { service, teamId } = await fixture(t);
  await service.dispatch({ requestId: 'mail-1', teamId, action: 'mail.send', payload: { messageId: 'message-1', toMemberId: 'member-1', content: '两处接口需要你裁决：回退模型与门顺序。', deliveryMode: 'queue' } }, asMember(teamId, 'member-2', 'session-2'));

  let view = await service.get({ teamId });
  assert.equal(view.summary.unread.total, 1);
  assert.equal(view.summary.unread.toLead, 1);
  assert.deepEqual(view.summary.unread.recent.map(item => [item.messageId, item.toMemberId, item.fromMemberId]), [['message-1', 'member-1', 'member-2']]);
  assert.match(view.summary.unread.recent[0].excerpt, /回退模型/);

  // Admission is the Host's step: until it lands, the recipient may not mark the mail read.
  await assert.rejects(
    service.dispatch({ requestId: 'read-1', teamId, action: 'mail.read', payload: { messageId: 'message-1' } }, asMember(teamId, 'member-1', 'session-1')),
    error => error.code === 'team/invalid-state' && /out of order/.test(error.message),
  );
  view = await service.get({ teamId });
  assert.equal(view.summary.unread.total, 1);
  assert.equal(view.mailbox[0].state, 'queued');
});

test('the summary names a staged plan and follows the halt switch', async t => {
  const staged = await fixture(t, { confirm: false });
  let view = await staged.service.get({ teamId: staged.teamId });
  assert.equal(view.summary.planState, 'staged');

  const { service, teamId } = await fixture(t);
  await service.dispatch({ requestId: 'halt-1', teamId, action: 'team.halt', payload: { reason: '冻结' } }, user);
  view = await service.get({ teamId });
  assert.equal(view.summary.halted, true);
  assert.equal(view.summary.counts.halted, true);

  await service.dispatch({ requestId: 'resume-1', teamId, action: 'team.resume', payload: {} }, user);
  view = await service.get({ teamId });
  assert.equal(view.summary.halted, false);
});
