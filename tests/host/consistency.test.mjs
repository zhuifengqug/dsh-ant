import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import { z } from 'zod';
import { AntService } from '../../src/host/service.mjs';
import { createAntTools } from '../../src/host/tool.mjs';
import { createAntCommand } from '../../src/host/command.mjs';
import { createTypertSpec } from '../../src/host/typert-spec.mjs';

const createPayload = {
  goal: 'Cross-surface consistency',
  workspaceRelativePath: '.',
  plan: {
    planId: 'plan-consistency', mode: 'normal', maxActiveAttempts: 2,
    tasks: [{ taskId: 'task-consistency', title: 'Compare receipts', objective: 'Compare every entry surface', inScope: ['.'], outOfScope: [], acceptance: ['receipts match'], verify: ['node --test'] }],
    dependencies: [], qualityGates: [],
  },
  members: [
    { memberId: 'member-1', role: 'engineer', sessionMode: 'persistent', sessionId: 'session-1', provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [] },
    { memberId: 'member-2', role: 'reviewer', sessionMode: 'persistent', sessionId: 'session-2', provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [] },
  ],
};

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-consistency-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function receiptShape(receipt) {
  return { requestId: receipt.requestId, teamId: receipt.teamId, firstEventSeq: receipt.firstEventSeq, lastEventSeq: receipt.lastEventSeq, eventIds: receipt.eventIds, viewState: receipt.viewState };
}

test('command, tool and Remote surfaces return one identical receipt per request', async t => {
  const root = await temporaryRoot(t);
  const context = new Context();
  context.provide('sessionController', { async prompt(request, signal) { assert.equal(signal instanceof AbortSignal, true); return { accepted: true }; } });
  const service = new AntService(context, { workspaceRoot: root, ownerId: 'consistency-host' });
  t.after(() => service.close());

  const signal = new AbortController().signal;
  const command = createAntCommand(service);
  const tool = createAntTools(service).find(item => item.name === 'ant_team_dispatch');
  const remote = createTypertRemoteInfo(createTypertSpec(), z);
  const invocation = { peer: { principal: { kind: 'owner', id: 'local-owner' } } };
  const callRemote = request => remote.methods['team/dispatch'].invoke(
    { team: { dispatch: (input, receivedSignal) => service.dispatchFromRemote(input, invocation, receivedSignal) } },
    { request },
    signal,
  );

  const created = JSON.parse((await command.handler({ rawInput: JSON.stringify({ requestId: 'consistency-create', action: 'team.create', payload: createPayload }), signal })).text);
  const request = { requestId: 'consistency-mail', teamId: created.teamId, action: 'mail.send', payload: { messageId: 'consistency-message', toMemberId: 'member-2', content: 'compare surfaces', deliveryMode: 'queue' } };

  const viaCommand = JSON.parse((await command.handler({ rawInput: JSON.stringify(request), signal })).text);
  const viaRemote = await callRemote(request);
  const viaTool = await tool.execute({ request }, { agent: { session: { id: 'session-1' } }, signal });

  assert.equal(viaCommand.outcome, 'committed');
  assert.equal(viaRemote.outcome, 'duplicate');
  assert.equal(viaTool.outcome, 'duplicate');
  assert.deepEqual(receiptShape(viaRemote), receiptShape(viaCommand));
  assert.deepEqual(receiptShape(viaTool), receiptShape(viaCommand));
  assert.equal(viaCommand.firstEventSeq <= viaCommand.lastEventSeq, true);
  assert.equal((await service.get({ teamId: created.teamId })).mailbox.length, 1, 'one request appends one message');
});

test('no surface lets a caller act outside its own principal', async t => {
  const root = await temporaryRoot(t);
  const context = new Context();
  const service = new AntService(context, { workspaceRoot: root, ownerId: 'consistency-guard' });
  t.after(() => service.close());

  const signal = new AbortController().signal;
  const tool = createAntTools(service).find(item => item.name === 'ant_team_dispatch');
  const created = await service.dispatchAsOwner({ requestId: 'guard-create', action: 'team.create', payload: createPayload });

  const outsider = await tool.execute({ request: { requestId: 'guard-outsider', teamId: created.teamId, action: 'batch.release', payload: { batchId: 'batch-1', taskIds: ['task-consistency'] } } }, { agent: { session: { id: 'session-unknown' } }, signal });
  assert.equal(outsider.code, 'team/forbidden');

  const member = await tool.execute({ request: { requestId: 'guard-member', teamId: created.teamId, action: 'batch.release', payload: { batchId: 'batch-1', taskIds: ['task-consistency'] } } }, { agent: { session: { id: 'session-1' } }, signal });
  assert.equal(member.code, 'team/forbidden', 'members never release their own batches');

  const anonymous = await tool.execute({ request: { requestId: 'guard-anon', teamId: created.teamId, action: 'team.archive', payload: {} } }, {});
  assert.equal(anonymous.code, 'team/forbidden');

  const remote = createTypertRemoteInfo(createTypertSpec(), z);
  const rejected = await remote.methods['team/dispatch'].invoke(
    { team: { dispatch: (input, receivedSignal) => service.dispatchFromRemote(input, { peer: { principal: { kind: 'agent', id: 'other' } } }, receivedSignal) } },
    { request: { requestId: 'guard-remote', teamId: created.teamId, action: 'team.archive', payload: {} } },
    signal,
  ).then(value => ({ value }), error => ({ error }));
  assert.equal(rejected.error?.code, 'team/forbidden');
  assert.equal((await service.get({ teamId: created.teamId })).lifecycle, 'staged');
});
