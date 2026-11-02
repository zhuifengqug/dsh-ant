import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import { z } from 'zod';
import { apply } from '../../index.js';
import { ownerContext, remoteContext } from '../../src/host/context.mjs';
import { createQunceCommand } from '../../src/host/command.mjs';
import { TianshuQunceService } from '../../src/host/service.mjs';
import { createQunceTool } from '../../src/host/tool.mjs';
import { createTypertSpec } from '../../src/host/typert-spec.mjs';
import { SessionAdapter } from '../../src/host/session-adapter.mjs';
import { TYPERT } from '../../typert.host.mjs';

const createPayload = {
  goal: 'Host integration test',
  workspaceRelativePath: '.',
  plan: {
    planId: 'plan-host', mode: 'normal', maxActiveAttempts: 1,
    tasks: [{ taskId: 'host-task', title: 'Exercise Host', objective: 'Exercise the Host facade', inScope: ['.'], outOfScope: [], acceptance: ['action commits'], verify: ['node --test'] }],
    dependencies: [], qualityGates: [],
  },
  members: [{ memberId: 'member-1', role: 'engineer', sessionMode: 'persistent', sessionId: 'session-1', provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [] }],
};

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qunce-host-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('trusted context accepts only owner principals and ignores request-shaped identity', () => {
  assert.deepEqual(ownerContext(), { actor: 'user', principal: { kind: 'owner' } });
  assert.deepEqual(remoteContext({ peer: { principal: { kind: 'owner', id: 'local-owner' } } }), ownerContext());
  assert.throws(() => remoteContext({ peer: { principal: { kind: 'agent', id: 'caller' } } }), { code: 'team/forbidden' });
  assert.deepEqual(remoteContext({ peer: { principal: { kind: 'owner' } }, actor: 'agent' }), ownerContext());
});

test('command dispatches as the owner and returns stable parse errors', async () => {
  const calls = [];
  const command = createQunceCommand({
    async dispatchAsOwner(request, signal) {
      calls.push({ request, signal });
      return { outcome: 'committed', requestId: request.requestId, teamId: 'team-1', lastEventSeq: 3 };
    },
  });
  const signal = new AbortController().signal;
  const success = await command.handler({ rawInput: JSON.stringify({ requestId: 'cmd-1' }), signal });
  assert.deepEqual(success, {
    kind: 'success',
    text: JSON.stringify({ outcome: 'committed', requestId: 'cmd-1', teamId: 'team-1', lastEventSeq: 3 }),
    sourceEventSeq: 3,
  });
  assert.equal(calls[0].signal, signal);
  assert.equal(calls[0].request.requestId, 'cmd-1');
  const invalid = await command.handler({ rawInput: '{' });
  assert.equal(JSON.parse(invalid.text).code, 'team/invalid-action');
});

test('tool schema compiles, validates arguments, and shares the agent service operation', async () => {
  const calls = [];
  const tool = defineTool(createQunceTool({
    async dispatchAsAgent(request, agent, signal) {
      calls.push({ request, agent, signal });
      return { outcome: 'committed', requestId: request.requestId, teamId: request.teamId };
    },
  }));
  const agent = { session: { id: 'session-1' } };
  const signal = new AbortController().signal;
  const result = await tool.execute({ request: { requestId: 'tool-1', teamId: 'team-1' } }, { agent, signal });
  assert.deepEqual(result, { outcome: 'committed', requestId: 'tool-1', teamId: 'team-1' });
  assert.equal(calls[0].agent, agent);
  assert.equal(calls[0].signal, signal);
  await assert.rejects(() => tool.execute({ unexpected: true }, { agent }), error => error.name === 'ToolArgsError');
  assert.equal(tool.output.schema.oneOf.length, 2);
  assert.equal(tool.output.schema.oneOf[0].additionalProperties, false);
  assert.equal(tool.output.schema.oneOf[1].additionalProperties, false);
});

test('SessionAdapter resolves agents and forwards prompt admission and model selection unchanged', async () => {
  const calls = [];
  const controller = {
    async resolveAgent(sessionId) {
      calls.push(['resolveAgent', sessionId]);
      return { agent: { id: 'agent-1', sessionId } };
    },
    async create(request) {
      calls.push(['create', request]);
      return { sessionId: 'session-created', agentPreset: request.agentPreset };
    },
    async prompt(request, signal) {
      calls.push(['prompt', request, signal]);
      return { accepted: true };
    },
    async cancel(request) {
      calls.push(['cancel', request]);
      return { accepted: true };
    },
    async selectModel(request, signal) {
      calls.push(['selectModel', request, signal]);
      return { selected: true };
    },
  };
  const adapter = new SessionAdapter(controller);
  const signal = new AbortController().signal;
  const createRequest = { cwd: '.', agentPreset: 'fixture' };
  const promptRequest = { sessionId: 'session-1', requestId: 'prompt-1', mode: 'queue', content: [{ type: 'text', text: 'work' }] };
  const cancelRequest = { sessionId: 'session-1' };
  const modelRequest = { sessionId: 'session-1', provider: 'fixture', model: 'fixture-model' };

  assert.deepEqual(await adapter.resolve('session-1'), { id: 'agent-1', sessionId: 'session-1' });
  assert.deepEqual(await adapter.create(createRequest), { sessionId: 'session-created', agentPreset: 'fixture' });
  assert.deepEqual(await adapter.prompt(promptRequest, signal), { accepted: true });
  assert.deepEqual(await adapter.cancel(cancelRequest), { accepted: true });
  assert.deepEqual(await adapter.selectModel(modelRequest, signal), { selected: true });
  assert.deepEqual(calls, [
    ['resolveAgent', 'session-1'],
    ['create', createRequest],
    ['prompt', promptRequest, signal],
    ['cancel', cancelRequest],
    ['selectModel', modelRequest, signal],
  ]);
  await assert.rejects(() => new SessionAdapter({ resolveAgent: async () => undefined }).resolve('missing'), { code: 'team/session-not-found' });
});

test('mail delivery sends queue and steer prompts, records admission, and keeps one WAL stream', async t => {
  const root = await temporaryRoot(t);
  const prompts = [];
  const controller = {
    async prompt(request, signal) {
      prompts.push({ request, signal });
      assert.equal(signal instanceof AbortSignal, true);
      return { accepted: true };
    },
  };
  const context = new Context();
  context.provide('sessionController', controller);
  const service = new TianshuQunceService(context, { workspaceRoot: root, ownerId: 'mail-host' });
  t.after(() => service.close());

  const created = await service.dispatchAsOwner({ requestId: 'mail-create-host', action: 'team.create', payload: createPayload });
  for (const [requestId, messageId, mode] of [['mail-queue-host', 'message-queue', 'queue'], ['mail-steer-host', 'message-steer', 'steer']]) {
    await service.dispatchAsOwner({ requestId, teamId: created.teamId, action: 'mail.send', payload: { messageId, toMemberId: 'member-1', content: `${mode} content`, deliveryMode: mode } });
  }
  for (let i = 0; i < 80; i++) {
    const view = await service.get({ teamId: created.teamId });
    if (view.mailbox.every(mail => mail.state === 'admitted')) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const view = await service.get({ teamId: created.teamId });
  assert.deepEqual(view.mailbox.map(mail => mail.state), ['admitted', 'admitted']);
  assert.deepEqual(prompts.map(item => item.request.mode).sort(), ['queue', 'steer']);
  assert.deepEqual(prompts.map(item => item.request.content[0]), [{ type: 'text', text: 'queue content' }, { type: 'text', text: 'steer content' }]);
  assert.equal(view.cursor, 5);
  assert.deepEqual(view.mailbox.map(mail => mail.receipts.map(receipt => receipt.stage)), [['admitted'], ['admitted']]);
});

test('mail delivery retries a failed prompt and recovers queued intent after service restart', async t => {
  const root = await temporaryRoot(t);
  let attempts = 0;
  const failingContext = new Context();
  failingContext.provide('sessionController', { async prompt() { attempts += 1; throw new Error('controller temporarily unavailable'); } });
  const first = new TianshuQunceService(failingContext, { workspaceRoot: root, ownerId: 'restart-host' });
  const created = await first.dispatchAsOwner({ requestId: 'mail-restart-create', action: 'team.create', payload: createPayload });
  await first.dispatchAsOwner({ requestId: 'mail-restart-send', teamId: created.teamId, action: 'mail.send', payload: { messageId: 'message-restart', toMemberId: 'member-1', content: 'retry me', deliveryMode: 'queue' } });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await first.get({ teamId: created.teamId })).mailbox[0].state, 'queued');
  await first.close();
  assert.equal(attempts >= 1, true);

  const recoveredContext = new Context();
  const recoveredPrompts = [];
  recoveredContext.provide('sessionController', { async prompt(request, signal) { recoveredPrompts.push({ request, signal }); return { accepted: true }; } });
  const second = new TianshuQunceService(recoveredContext, { workspaceRoot: root, ownerId: 'restart-host-2' });
  t.after(() => second.close());
  for (let i = 0; i < 80; i++) {
    const view = await second.get({ teamId: created.teamId });
    if (view.mailbox[0].state === 'admitted') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const view = await second.get({ teamId: created.teamId });
  assert.equal(view.mailbox[0].state, 'admitted');
  assert.equal(recoveredPrompts.length, 1);
  assert.equal(recoveredPrompts[0].request.requestId.startsWith('qunce-mail-'), true);
  assert.equal(recoveredPrompts[0].signal instanceof AbortSignal, true);
});

test('Typert direct descriptors bind service implementations and enforce strict named inputs', async () => {
  const remoteInfo = createTypertRemoteInfo(createTypertSpec(), z);
  const descriptors = Object.fromEntries(remoteInfo.descriptors.map(descriptor => [descriptor.namespace + '/' + descriptor.method, descriptor]));
  assert.deepEqual(Object.keys(descriptors).sort(), ['team/dispatch', 'team/get', 'team/list']);
  assert.equal(descriptors['team/dispatch'].implementation, 'dispatch');
  assert.equal(descriptors['team/get'].implementation, 'get');
  assert.equal(descriptors['team/list'].implementation, 'list');
  const request = { requestId: 'remote-1', action: 'team.create', payload: createPayload };
  assert.deepEqual(remoteInfo.methods['team/dispatch'].input({ strict: true }).create().parse({ request }), { request });
  assert.throws(() => remoteInfo.methods['team/dispatch'].input({ strict: true }).create().parse({ request, extra: true }));
  const signal = new AbortController().signal;
  const calls = [];
  const value = await remoteInfo.methods['team/dispatch'].invoke({ team: { async dispatch(input, receivedSignal) { calls.push({ input, receivedSignal }); return 'ok'; } } }, { request }, signal);
  assert.equal(value, 'ok');
  assert.deepEqual(calls, [{ input: request, receivedSignal: signal }]);
});

test('Cordis service binds Remote invocation, commits through TeamActionService, and closes idempotently', async t => {
  const context = new Context();
  new TypertRegistry(context);
  context.provide('remoteAccess', { decide: () => ({ kind: 'allow' }) });
  const root = await temporaryRoot(t);
  const service = new TianshuQunceService(context, { workspaceRoot: root, ownerId: 'host-test' });
  context.typert.register(TYPERT);
  const gateway = new TypertGatewayService(context, {});
  t.after(async () => {
    await service.close();
    await context.fiber.dispose();
  });
  assert.equal(context.tianshuQunce.name, 'tianshuQunce');
  assert.equal(service.typertRemote.service, service);
  assert.equal(service.typertRemote.serviceKey, 'tianshuQunce');
  assert.equal(service.typertRemote.namespace, 'team');

  const request = { requestId: 'service-create', action: 'team.create', payload: createPayload };
  const created = await service.dispatchAsOwner(request);
  assert.equal(created.outcome, 'committed');
  assert.equal((await service.get({ teamId: created.teamId })).teamId, created.teamId);

  const remoteContext = context.extend({ invocation: { peer: { principal: { kind: 'owner' } } } });
  const remoteService = remoteContext.tianshuQunce;
  const remoteCreated = await remoteService.dispatch({ requestId: 'service-remote-create', action: 'team.create', payload: createPayload });
  assert.equal(remoteCreated.outcome, 'committed');

  const untrustedContext = context.extend({ invocation: { peer: { principal: { kind: 'agent', id: 'session-1' } } } });
  await assert.rejects(untrustedContext.tianshuQunce.dispatch({ requestId: 'service-denied', action: 'team.create', payload: createPayload }), { code: 'team/forbidden' });

  const peer = { principal: { kind: 'owner' }, signal: new AbortController().signal, interactions: 'answer' };
  const gatewayResult = await gateway.invoke({ namespace: 'team', method: 'dispatch', args: { request: { requestId: 'gateway-create', action: 'team.create', payload: createPayload } }, peer });
  assert.equal(gatewayResult.outcome, 'committed');

  await service.close();
  await service.close();
  await assert.rejects(service.ready(), { code: 'team/lease-lost' });
});

test('apply registers command and tool once; Cordis fiber disposal unregisters in reverse order', async t => {
  const context = new Context();
  const root = await temporaryRoot(t);
  const events = [];
  for (const name of ['commands', 'tools', 'sessionController']) {
    const value = name === 'sessionController' ? { async resolveAgent() { return undefined; } } : {
      register(definition) {
        events.push(`register:${name}:${definition.name ?? definition.package}`);
        return async () => { events.push(`dispose:${name}`); };
      },
    };
    context.provide(name, value);
  }
  apply(context, { workspaceRoot: root, ownerId: 'apply-test' });
  const service = context.tianshuQunce;
  assert.equal(events.filter(event => event.startsWith('register:')).length, 2);
  await context.fiber.dispose();
  assert.deepEqual(events.filter(event => event.startsWith('dispose:')), ['dispose:tools', 'dispose:commands']);
  await assert.rejects(service.ready(), { code: 'team/lease-lost' });
  t.after(async () => { await context.fiber.dispose(); });
});
