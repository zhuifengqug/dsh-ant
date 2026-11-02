import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { z } from 'zod';

const root = path.resolve(import.meta.dirname, '../..');
const clientPath = path.join(root, 'client.js');

function fakeReact() {
  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? null, children };
    },
    useEffect(effect) {
      effect();
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
  };
}

async function loadClient() {
  const source = await readFile(clientPath, 'utf8');
  let registration;
  const window = {
    __ModuleLoader__: {
      load(value) {
        registration = value;
      },
    },
  };
  vm.runInNewContext(source, {
    AbortController,
    Date,
    Math,
    console,
    window,
  }, { filename: clientPath });
  assert.equal(registration?.id, '@zhuifengqug/dsh-tianshu-qunce');
  const plugin = registration.factory(specifier => {
    if (specifier === 'react') return fakeReact();
    if (specifier === 'zod') return { z };
    throw new Error(`unexpected client dependency: ${specifier}`);
  });
  return { plugin, source };
}

function createClientContext(remoteTeam) {
  const effects = [];
  const registrations = [];
  const disposeOrder = [];
  let remoteUnmounts = 0;
  let localeRegistrations = 0;
  let localeSubscriptions = 0;
  let followDisposals = 0;

  const remote = {
    get team() { throw new Error('remote.team must be injected'); },
    async $mount(contribution) {
      remote.mounted = contribution;
      return async () => {
        remoteUnmounts += 1;
        disposeOrder.push('remote');
      };
    },
  };
  const locale = {
    getSnapshot: () => ({ active: 'en' }),
    subscribe(listener) {
      localeSubscriptions += 1;
      locale.listener = listener;
      return () => {
        localeSubscriptions -= 1;
        disposeOrder.push('locale-subscription');
      };
    },
    register(namespace, dictionaries) {
      localeRegistrations += 1;
      locale.namespace = namespace;
      locale.dictionaries = dictionaries;
      return () => {
        localeRegistrations -= 1;
        disposeOrder.push('locale');
      };
    },
  };
  const slots = {
    inject(key, callback) {
      const disposer = callback();
      return disposer;
    },
    register(options, component) {
      const record = { options, component, disposed: false };
      registrations.push(record);
      return async () => {
        record.disposed = true;
        disposeOrder.push(options.id ?? options.key ?? options.name);
      };
    },
  };
  const makeContext = (remoteValue, effectList = effects) => ({
    locale,
    remote: remoteValue,
    slots,
    effect(callback, label) {
      effectList.push({ cleanup: callback(), label });
    },
  });
  const ctx = makeContext(remote);
  ctx.inject = (keys, callback) => {
    assert.equal(Array.from(keys).join(','), 'remote.team');
    const childEffects = [];
    const child = makeContext({ team: remoteTeam }, childEffects);
    callback(child);
    return {
      async dispose() {
        followDisposals += 1;
        for (const effect of [...childEffects].reverse()) {
          if (typeof effect.cleanup === 'function') await effect.cleanup();
        }
        disposeOrder.push('follow');
      },
    };
  };
  return {
    ctx,
    effects,
    registrations,
    disposeOrder,
    remote,
    get followDisposals() { return followDisposals; },
    get remoteUnmounts() { return remoteUnmounts; },
    get localeRegistrations() { return localeRegistrations; },
    get localeSubscriptions() { return localeSubscriptions; },
    async disposeEffects() {
      for (const effect of [...effects].reverse()) {
        if (typeof effect.cleanup === 'function') await effect.cleanup();
      }
    },
  };
}

test('client factory is lazy and declares the approved slots', async () => {
  const { plugin, source } = await loadClient();
  assert.equal(Array.from(plugin.inject).join(','), 'remote,slots,locale');
  assert.equal(typeof plugin.apply, 'function');
  assert.match(source, /window\.__ModuleLoader__\.load/);
  assert.doesNotMatch(source, /host\.call/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.match(source, /key: PANEL_ID/);
  assert.match(source, /id: PANEL_ID/);
});

test('client RemoteInfo uses strict named input and the Host implementation wire', async () => {
  const { plugin } = await loadClient();
  const calls = [];
  const remoteTeam = {
    dispatch: async (...args) => {
      calls.push(args);
      return { outcome: 'committed', requestId: 'wire-1' };
    },
    get: async () => ({}),
    list: async () => ({ teams: [] }),
  };
  const runtime = createClientContext(remoteTeam);
  await plugin.apply(runtime.ctx);
  const descriptors = runtime.remote.mounted.descriptors;
  const dispatch = descriptors.find(item => item.namespace === 'team' && item.method === 'dispatch');
  const get = descriptors.find(item => item.namespace === 'team' && item.method === 'get');
  const list = descriptors.find(item => item.namespace === 'team' && item.method === 'list');
  assert.equal(dispatch.implementation, 'dispatch');
  assert.equal(get.implementation, 'get');
  assert.equal(list.implementation, 'list');
  assert.deepEqual(dispatch.input({ strict: true }).create().parse({ request: { requestId: 'wire-1', action: 'team.create', payload: {} } }), {
    request: { requestId: 'wire-1', action: 'team.create', payload: {} },
  });
  assert.throws(() => dispatch.input({ strict: true }).create().parse({ request: {}, extra: true }));
  const signal = new AbortController().signal;
  const actualRequest = { requestId: 'wire-2', action: 'team.create', payload: {} };
  await dispatch.invoke({ team: remoteTeam }, { request: actualRequest }, signal);
  assert.deepEqual(calls.at(-1), [actualRequest, signal]);
  assert.equal(dispatch.cancellation.parameter, 'signal');
  await runtime.disposeEffects();
});

test('client apply mounts both slots, reloads after a receipt, and disposes in reverse order', async () => {
  const calls = [];
  let failList = false;
  const remoteTeam = {
    async list(request, signal) {
      calls.push(['list', request, signal]);
      if (failList) {
        const error = new Error('cursor moved');
        error.code = 'team/stale-cursor';
        return { ok: false, error };
      }
      return { ok: true, value: { teams: [{ teamId: 'team-1', goal: 'Ship', lifecycle: 'planned', cursor: 4 }] } };
    },
    async get(request, signal) {
      calls.push(['get', request, signal]);
      return { ok: true, value: { teamId: request.teamId, goal: 'Ship', lifecycle: 'planned', cursor: request.atLeastEventSeq ?? 4, members: [], attempts: [], tasks: [], plan: { dependencies: [] } } };
    },
    async dispatch(request, signal) {
      calls.push(['dispatch', request, signal]);
      return { ok: true, value: { outcome: 'committed', requestId: request.requestId, teamId: request.teamId, lastEventSeq: 8 } };
    },
  };
  const runtime = createClientContext(remoteTeam);
  const { plugin } = await loadClient();
  const cleanup = await plugin.apply(runtime.ctx);
  assert.equal(runtime.remote.mounted.package, '@zhuifengqug/dsh-tianshu-qunce');
  assert.deepEqual(runtime.registrations.map(item => [item.options.name, item.options.key ?? item.options.id]), [
    ['main', 'tianshu-qunce'],
    ['sidebar.panellist', 'tianshu-qunce'],
  ]);
  assert.equal(runtime.localeRegistrations, 1);
  assert.equal(runtime.localeSubscriptions, 1);

  const main = runtime.registrations[0];
  const props = main.options.inject();
  main.component(props);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.slice(0, 2).map(item => item[0]), ['list', 'get']);
  assert.equal(props.model.getSnapshot().status, 'ready');
  assert.equal(props.model.getSnapshot().teams[0].teamId, 'team-1');
  assert.equal(props.model.getSnapshot().teams[0].goal, 'Ship');
  assert.equal(props.model.getSnapshot().view.cursor, 4);

  await props.model.dispatch('team.archive', {});
  assert.deepEqual(calls.slice(-2).map(item => item[0]), ['dispatch', 'get']);
  assert.equal(calls.at(-1)[1].atLeastEventSeq, 8);
  assert.equal(props.model.getSnapshot().receipt.outcome, 'committed');

  failList = true;
  await props.model.loadList();
  assert.equal(props.model.getSnapshot().status, 'stale-cursor');
  assert.equal(props.model.getSnapshot().error.code, 'team/stale-cursor');

  await cleanup();
  assert.deepEqual(runtime.disposeOrder.slice(0, 6), [
    'tianshu-qunce', 'tianshu-qunce', 'locale-subscription', 'locale', 'follow', 'remote',
  ]);
  assert.equal(runtime.followDisposals, 1);
  await runtime.disposeEffects();
  assert.equal(runtime.remoteUnmounts, 1);
  assert.equal(runtime.localeRegistrations, 0);
  assert.equal(runtime.localeSubscriptions, 0);
});

test('client preserves Remote error envelopes from get and dispatch', async () => {
  const notFound = Object.assign(new Error('missing team'), { code: 'team/not-found' });
  const leaseConflict = Object.assign(new Error('writer is active'), { code: 'team/lease-conflict' });
  let failGet = false;
  let failDispatch = false;
  const remoteTeam = {
    async list() {
      return { ok: true, value: { teams: [{ teamId: 'team-1', goal: 'Ship', lifecycle: 'planned', cursor: 1 }] } };
    },
    async get(request) {
      if (failGet) return { ok: false, error: notFound };
      return { ok: true, value: { teamId: request.teamId, lifecycle: 'planned', cursor: 1, members: [], attempts: [], tasks: [], plan: { dependencies: [] } } };
    },
    async dispatch() {
      if (failDispatch) return { ok: false, error: leaseConflict };
      return { ok: true, value: { outcome: 'committed', requestId: 'ok', teamId: 'team-1', lastEventSeq: 1 } };
    },
  };
  const runtime = createClientContext(remoteTeam);
  const { plugin } = await loadClient();
  const cleanup = await plugin.apply(runtime.ctx);
  const main = runtime.registrations[0];
  const props = main.options.inject();
  main.component(props);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(props.model.getSnapshot().status, 'ready');

  failGet = true;
  await props.model.selectTeam('team-1');
  assert.equal(props.model.getSnapshot().status, 'not-found');
  assert.equal(props.model.getSnapshot().error.code, 'team/not-found');

  failGet = false;
  await props.model.loadList();
  failDispatch = true;
  await props.model.dispatch('team.archive', {});
  assert.equal(props.model.getSnapshot().status, 'lease');
  assert.equal(props.model.getSnapshot().error.code, 'team/lease-conflict');

  await cleanup();
  await runtime.disposeEffects();
});

test('package manifest publishes the Client half and verified Host injects', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.exports['./client'], './client.js');
  assert.ok(manifest.files.includes('client.js'));
  assert.deepEqual(manifest.dsh.client, {
    platform: 'web',
    immediately: true,
    inject: [
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-sidebar',
    ],
  });
  assert.equal(manifest.dsh.client.external, undefined);
});
