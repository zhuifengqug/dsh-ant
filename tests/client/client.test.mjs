import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { z } from 'zod';

const root = path.resolve(import.meta.dirname, '../..');
const clientPath = path.join(root, 'client.js');

function createFakeReact() {
  const hooks = [];
  let cursor = 0;
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
    useState(initial) {
      const slot = cursor++;
      if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial;
      return [hooks[slot], next => { hooks[slot] = typeof next === 'function' ? next(hooks[slot]) : next; }];
    },
    reset() { cursor = 0; },
  };
}
function fakeReact() { return createFakeReact(); }

async function loadClient(react = fakeReact()) {
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
  assert.equal(registration?.id, '@zhuifengqug/dsh-ant');
  const plugin = registration.factory(specifier => {
    if (specifier === 'react') return react;
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
  const layout = { selected: [], selectPanel(panelId) { layout.selected.push(panelId); } };
  const conversation = { events: { definitions: [], register(definition) { conversation.events.definitions.push(definition); return () => { definition.disposed = true; }; } } };
  const cardInject = (keys, callback) => {
    assert.equal(Array.from(keys).join(','), 'uiConversation,layout');
    const cardEffects = [];
    const card = makeContext({ team: remoteTeam }, cardEffects);
    card.uiConversation = conversation;
    card.layout = layout;
    card.inject = cardInject;
    callback(card);
    return {
      async dispose() {
        for (const effect of [...cardEffects].reverse()) if (typeof effect.cleanup === 'function') await effect.cleanup();
        disposeOrder.push('card');
      },
    };
  };
  const ctx = makeContext(remote);
  ctx.inject = (keys, callback) => {
    const names = Array.from(keys).join(',');
    if (names === 'uiConversation,layout') return cardInject(keys, callback);
    assert.equal(names, 'remote.team');
    const childEffects = [];
    const child = makeContext({ team: remoteTeam }, childEffects);
    child.inject = cardInject;
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
    layout,
    conversation,
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

test('client apply mounts every surface, reloads after a receipt, and disposes in reverse order', async () => {
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
    async settings(request, signal) {
      calls.push(['settings', request, signal]);
      return { ok: true, value: { autonomy: 'L2', batchWindowMinutes: 30, maxActiveAttempts: 8, defaultVariants: 1, variantWriteTasks: false } };
    },
    async writeSettings(request, signal) {
      calls.push(['writeSettings', request, signal]);
      return { ok: true, value: { ...request.patch } };
    },
    async dispatch(request, signal) {
      calls.push(['dispatch', request, signal]);
      return { ok: true, value: { outcome: 'committed', requestId: request.requestId, teamId: request.teamId, lastEventSeq: 8 } };
    },
  };
  const runtime = createClientContext(remoteTeam);
  const { plugin } = await loadClient();
  const cleanup = await plugin.apply(runtime.ctx);
  assert.equal(runtime.remote.mounted.package, '@zhuifengqug/dsh-ant');
  assert.deepEqual(runtime.registrations.map(item => [item.options.name, item.options.key ?? item.options.id]), [
    ['main', 'ant'],
    ['sidebar.panellist', 'ant'],
    ['conversation.session.header.actions', 'ant'],
    ['conversation.composer.bar', 'ant'],
    ['settings.section', 'ant'],
    ['conversation.chat.node', 'ant-team'],
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
  assert.deepEqual(runtime.disposeOrder.slice(0, 10), [
    'ant', 'ant', 'ant', 'ant', 'ant', 'card', 'locale-subscription', 'locale', 'follow', 'remote',
  ]);
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
      '@deepseek-ai/dsh-client-ui-conversation',
    ],
  });
  assert.equal(manifest.dsh.client.external, undefined);
});

function findAllByClass(node, className, hits = []) {
  if (Array.isArray(node)) { for (const child of node) findAllByClass(child, className, hits); return hits; }
  if (!node || typeof node !== 'object') return hits;
  if (node.props?.className === className) hits.push(node);
  for (const child of node.children ?? []) findAllByClass(child, className, hits);
  return hits;
}

function findByClass(node, className) {
  return findAllByClass(node, className)[0];
}

function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (!node || typeof node !== 'object') return '';
  return (node.children ?? []).map(textOf).join('');
}

function renderDeep(node) {
  if (Array.isArray(node)) return node.map(renderDeep);
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function') return renderDeep(node.type(node.props));
  return { ...node, children: (node.children ?? []).map(renderDeep) };
}

function planOf(tree) {
  const nest = findByClass(tree, 'ant-nest');
  assert.equal(nest.props['aria-label'], 'Colony section');
  const nestElement = nest.children.find(child => typeof child.type === 'function');
  const plan = nestElement.type(nestElement.props);
  assert.equal(plan.props.className, 'ant-nest-plan');
  return plan;
}

async function mountWithView(view) {
  const calls = [];
  const remoteTeam = {
    async list() { return { ok: true, value: { teams: [{ teamId: 'team-1', goal: 'Ship', lifecycle: 'running', cursor: 4 }] } }; },
    async get(request) { return { ok: true, value: { ...view, teamId: request.teamId, cursor: view.cursor ?? 4 } }; },
    async dispatch(request) { calls.push(request); return { ok: true, value: { outcome: 'committed', requestId: request.requestId, teamId: request.teamId, lastEventSeq: 9 } }; },
  };
  const runtime = createClientContext(remoteTeam);
  const { plugin } = await loadClient();
  const cleanup = await plugin.apply(runtime.ctx);
  const main = runtime.registrations[0];
  const props = main.options.inject();
  main.component(props);
  await new Promise(resolve => setImmediate(resolve));
  const tree = main.component(props);
  const plan = planOf(tree);
  return { main, props, plan, calls, runtime, cleanup, tree };
}

test('colony section counts every task in exactly one of the five chambers', async () => {
  const view = {
    lifecycle: 'running',
    members: [
      { memberId: 'member-1', status: 'active', sessionId: 's1' },
      { memberId: 'member-2', status: 'removed' },
    ],
    attempts: [{ attemptId: 'attempt-1', taskId: 'task-3', memberId: 'member-1', state: 'running', generation: 1 }],
    tasks: [
      { taskId: 'task-1', state: 'pending' },
      { taskId: 'task-2', state: 'reviewed' },
      { taskId: 'task-3', state: 'running' },
      { taskId: 'task-4', state: 'completed' },
      { taskId: 'task-5', state: 'anomalous' },
    ],
    plan: { dependencies: [{ taskId: 'task-3', blockedByTaskId: 'task-1' }] },
  };
  const { props, plan, runtime, cleanup } = await mountWithView(view);
  const chambers = findAllByClass(plan, 'ant-chamber');
  assert.deepEqual(chambers.map(chamber => chamber.props['data-stage']), ['nursery', 'gate', 'corridor', 'pantry', 'refuse']);
  assert.deepEqual(chambers.map(chamber => textOf(chamber.children[0].children[1])), ['1', '1', '1', '1', '1']);
  assert.equal(props.model.getSnapshot().view.tasks.length, 5);
  const counts = findByClass(plan, 'ant-ants');
  assert.ok(counts, 'the corridor chamber carries the resident ant');
  assert.equal(findAllByClass(plan, 'ant-tunnel').length, 1);
  await cleanup();
  await runtime.disposeEffects();
});

test('the gate releases the pending batch from the keyboard', async () => {
  const view = {
    lifecycle: 'running',
    cursor: 4,
    members: [{ memberId: 'member-1', status: 'active', sessionId: 's1' }],
    attempts: [],
    tasks: [{ taskId: 'task-2', state: 'reviewed' }, { taskId: 'task-6', state: 'reviewed' }],
    releaseQueue: [{ taskId: 'task-2' }, { taskId: 'task-6' }],
    plan: { dependencies: [] },
  };
  const { props, plan, calls, runtime, cleanup } = await mountWithView(view);
  const gate = findByClass(plan, 'ant-gate');
  assert.equal(gate.props.disabled, false);
  assert.equal(textOf(gate), 'Gatepending release 2');
  gate.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].action, 'batch.release');
  assert.equal(JSON.stringify(calls[0].payload), JSON.stringify({ batchId: 'batch-5', taskIds: ['task-2', 'task-6'] }));

  const focused = [];
  const fakeGate = { focus: () => focused.push('gate') };
  plan.props.onKeyDown({ key: '2', preventDefault() {}, currentTarget: { querySelector: () => fakeGate } });
  assert.equal(props.model.getSnapshot().selectedStage, 'gate');
  assert.deepEqual(focused, ['gate']);
  plan.props.onKeyDown({ key: '5', preventDefault() {}, currentTarget: { querySelector: () => fakeGate } });
  assert.equal(props.model.getSnapshot().selectedStage, 'refuse');
  plan.props.onKeyDown({ key: 'Escape', currentTarget: { querySelector: () => fakeGate } });
  assert.equal(props.model.getSnapshot().selectedStage, undefined);
  await cleanup();
  await runtime.disposeEffects();
});

test('chambers stay distinguishable without accent colour and honour reduced motion', async () => {
  const { plugin, source } = await loadClient();
  assert.equal(typeof plugin.apply, 'function');
  for (const stage of ['nursery', 'gate', 'corridor', 'pantry', 'refuse']) {
    assert.match(source, new RegExp('\\.ant-chamber\\[data-stage=' + stage + '\\]\\{[^}]*border'));
  }
  assert.match(source, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(source, /@media\(max-width:1024px\)[^@]*ant-nest-plan/);
  assert.match(source, /@media\(max-width:768px\)[^@]*ant-nest-plan/);
  assert.doesNotMatch(source, /ant-orbit/);
});
function renderChild(tree, className) {
  const host = findByClass(tree, className);
  assert.ok(host, className + ' is rendered');
  const child = host.children.find(item => typeof item.type === 'function');
  assert.ok(child, className + ' delegates to a component');
  return child.type(child.props);
}

test('the header action badge counts the same pending release as the gate hall', async () => {
  const view = {
    lifecycle: 'running', cursor: 4,
    members: [{ memberId: 'member-1', status: 'active', sessionId: 's1' }],
    attempts: [],
    tasks: [{ taskId: 'task-1', state: 'reviewed' }, { taskId: 'task-2', state: 'reviewed' }, { taskId: 'task-3', state: 'pending' }],
    releaseQueue: [{ taskId: 'task-1' }, { taskId: 'task-2' }],
    plan: { dependencies: [] },
  };
  const remoteTeam = {
    async list() { return { ok: true, value: { teams: [{ teamId: 'team-1', goal: 'Ship', lifecycle: 'running', cursor: 4 }] } }; },
    async get(request) { return { ok: true, value: { ...view, teamId: request.teamId } }; },
    async dispatch() { return { ok: true, value: { outcome: 'committed' } }; },
  };
  const runtime = createClientContext(remoteTeam);
  const { plugin } = await loadClient();
  const cleanup = await plugin.apply(runtime.ctx);
  const surface = runtime.registrations.find(item => item.options.name === 'conversation.session.header.actions');
  const props = surface.options.inject();
  surface.component(props);
  await new Promise(resolve => setImmediate(resolve));
  const tree = surface.component(props);
  assert.ok(tree, 'the glyph renders with the locale');
  const glyph = findByClass(tree, 'ant-glyph');
  assert.equal(glyph.props['data-pending'], 2);
  assert.match(glyph.props.title, /2/);
  assert.equal(textOf(findByClass(tree, 'ant-badge')), '2');
  await cleanup();
  await runtime.disposeEffects();
});

test('the activity stream stays collapsed and counts running, idle and attention', async () => {
  const view = {
    lifecycle: 'running',
    members: [{ memberId: 'member-1', status: 'active', sessionId: 's1' }, { memberId: 'member-2', status: 'active', sessionId: 's2' }],
    attempts: [{ attemptId: 'attempt-1', taskId: 'task-1', memberId: 'member-1', state: 'running' }],
    tasks: [{ taskId: 'task-1', state: 'running' }, { taskId: 'task-2', state: 'anomalous' }],
    interruptions: [{ attemptId: 'attempt-0', taskId: 'task-0', reason: 'socket closed' }],
    plan: { dependencies: [] },
  };
  const { tree, runtime, cleanup } = await mountWithView(view);
  const stream = findByClass(renderChild(tree, 'ant-main'), 'ant-stream');
  assert.equal(stream.type, 'details');
  assert.equal(stream.props.open, undefined);
  const summary = textOf(stream.children[0]);
  assert.match(summary, /Running 1/);
  assert.match(summary, /Idle 1/);
  assert.match(summary, /Needs attention 2/);
  assert.equal(findAllByClass(stream, 'ant-note').length, 0, 'the rows list replaces the empty note');
  const rows = findAllByClass(stream, 'ant-row');
  assert.equal(rows.length, 4, 'one running, one idle and two attention rows');
  assert.ok(rows.some(row => row.props['data-kind'] === 'idle'), 'idle members keep their footprint');
  await cleanup();
  await runtime.disposeEffects();
});

test('the settings section reads the shared file and arms L3 before saving', async () => {
  const react = createFakeReact();
  let stored = { autonomy: 'L2', batchWindowMinutes: 30, maxActiveAttempts: 8, defaultVariants: 1, variantWriteTasks: false };
  const writes = [];
  const remoteTeam = {
    async settings() { return { ok: true, value: stored }; },
    async writeSettings(request) { writes.push(request.patch); stored = { ...stored, ...request.patch }; return { ok: true, value: stored }; },
  };
  const runtime = createClientContext(remoteTeam);
  const { plugin } = await loadClient(react);
  const cleanup = await plugin.apply(runtime.ctx);
  const record = runtime.registrations.find(item => item.options.name === 'settings.section');
  const props = record.options.inject();
  react.reset();
  const loading = record.component(props);
  assert.match(textOf(findByClass(loading, 'ant-settings')), /Loading team facts/);
  await new Promise(resolve => setImmediate(resolve));
  react.reset();
  const ready = record.component(props);
  assert.match(textOf(findByClass(ready, 'ant-settings')), /Autonomy/);
  const select = findAllByClass(ready, 'ant-field')[0].children.find(item => item.type === 'select');
  assert.ok(select, 'the autonomy field renders a select');
  select.props.onChange({ target: { value: 'L3' } });
  react.reset();
  const armed = record.component(props);
  assert.match(textOf(findByClass(armed, 'ant-warn')), /Switch anyway/);
  const confirm = findAllByClass(findByClass(armed, 'ant-warn'), 'ant-button')[0];
  confirm.props.onClick();
  react.reset();
  const chosen = record.component(props);
  const save = findAllByClass(chosen, 'ant-button').at(-1);
  save.props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes.at(-1).autonomy, 'L3');
  react.reset();
  assert.match(textOf(findAllByClass(record.component(props), 'ant-note').at(-1)), /Saved/);
  await cleanup();
  await runtime.disposeEffects();
});

test('the conversation threads one card per created team, from call to receipt', async () => {
  const runtime = createClientContext({ async get() { return { ok: false, error: new Error('unused') }; } });
  const { plugin } = await loadClient();
  const cleanup = await plugin.apply(runtime.ctx);
  const definition = runtime.conversation.events.definitions[0];
  assert.equal(definition.kind, 'ant-team');
  assert.equal(definition.target, 'chat');

  const args = JSON.stringify({ request: { action: 'team.create', payload: { goal: 'Ship the colony', plan: { mode: 'fast' }, members: [{ memberId: 'm1' }, { memberId: 'm2' }] } } });
  const call = { type: 'tool/call', data: { name: 'ant_team_dispatch', callId: 'call-1', arguments: args } };
  const started = definition.match(call);
  assert.equal(started.id, 'call-1');
  assert.equal(started.role, 'start');
  assert.equal(definition.match({ type: 'tool/call', data: { name: 'ant_team_get', callId: 'call-2', arguments: '{}' } }), null);
  assert.equal(definition.match({ type: 'tool/call', data: { name: 'ant_team_dispatch', callId: 'call-3', arguments: '{"request":{"action":"task.create"}}' } }), null);
  assert.equal(definition.match({ type: 'tool/result', data: { message: { source: { kind: 'assistant' } } } }), null);

  const context = { key: 'node-1', id: 'id-1', start: { event: { seq: 12 }, location: { turn: 1 } } };
  context.state = definition.start(context, { event: call, id: 'call-1', role: 'start' });
  assert.equal(definition.buildViewNode(context), null, 'the card waits for the receipt that names the team');

  const receipt = { type: 'tool/result', data: { message: { source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'text', text: JSON.stringify({ teamId: 'team-9', firstEventSeq: 3 }) }] } } };
  const updated = definition.match(receipt);
  assert.equal(updated.id, 'call-1');
  assert.equal(updated.role, 'update');
  context.state = definition.update(context, { event: receipt, id: 'call-1', role: 'update' });
  const node = definition.buildViewNode(context);
  assert.equal(node.key, 'node-1');
  assert.equal(node.kind, 'ant-team');
  assert.equal(node.id, 'id-1');
  assert.equal(node.target, 'chat');
  assert.equal(node.anchorSeq, 12);
  assert.equal(node.visibility, 'visible');
  assert.equal(node.data.teamId, 'team-9');
  assert.equal(node.data.goal, 'Ship the colony');
  assert.equal(node.data.mode, 'fast');
  assert.equal(node.data.memberCount, 2);

  const failed = { type: 'tool/result', data: { error: { code: 'team/forbidden' }, message: { source: { kind: 'tool', callId: 'call-1' }, content: [] } } };
  const rejected = { key: 'node-2', id: 'id-2', start: { event: { seq: 14 }, location: { turn: 1 } } };
  rejected.state = definition.start(rejected, { event: call, id: 'call-1', role: 'start' });
  rejected.state = definition.update(rejected, { event: failed, id: 'call-1', role: 'update' });
  assert.equal(definition.buildViewNode(rejected), null);

  await cleanup();
  await runtime.disposeEffects();
});

test('the sidebar entry and the team card both open the colony', async () => {
  const gets = [];
  const remoteTeam = {
    async list() { return { ok: true, value: { teams: [] } }; },
    async get(request) {
      gets.push(request.teamId);
      return { ok: true, value: { teamId: request.teamId, goal: 'Ship the colony', lifecycle: 'running', cursor: 5, members: [{ memberId: 'm1', status: 'active' }], attempts: [{ attemptId: 'a1', taskId: 't1', state: 'running' }], tasks: [{ taskId: 't1', state: 'reviewed', selfCompleted: true }], releaseQueue: [{ taskId: 't1' }], plan: { dependencies: [] } } };
    },
    async dispatch() { return { ok: true, value: { outcome: 'committed' } }; },
  };
  const react = fakeReact();
  const runtime = createClientContext(remoteTeam);
  const { plugin, source } = await loadClient(react);
  const cleanup = await plugin.apply(runtime.ctx);

  const glyph = runtime.registrations.find(item => item.options.name === 'sidebar.panellist');
  assert.equal(glyph.options.id, 'ant');
  assert.equal(typeof glyph.options.label, 'function');
  assert.equal(typeof glyph.options.label(), 'string');
  const idle = glyph.component({ size: 15, active: false });
  assert.equal(idle.type.name, 'AntShape');
  assert.equal(idle.props.className, 'ant-side');
  assert.equal(idle.props.size, 15);
  assert.equal(idle.props['data-state'], '');
  const active = glyph.component({ active: true });
  assert.equal(active.props['data-state'], 'active');
  assert.match(source, /focusable: 'false', \.\.\.rest/);

  const card = runtime.registrations.find(item => item.options.name === 'conversation.chat.node');
  assert.equal(card.options.key, 'ant-team');
  const props = { ...card.options.inject(), node: { data: { teamId: 'team-1', goal: 'Ship the colony', mode: 'normal', memberCount: 2 } } };
  react.reset();
  assert.match(textOf(findByClass(card.component(props), 'ant-card-facts')), /Loading team facts/);
  await new Promise(resolve => setImmediate(resolve));
  react.reset();
  const ready = card.component(props);
  assert.equal(gets[0], 'team-1');
  assert.ok(gets.every(id => id === 'team-1'));
  const facts = textOf(findByClass(ready, 'ant-card-facts'));
  assert.match(facts, /1 Members/);
  assert.match(facts, /1 Running/);
  assert.match(facts, /1 pending release/);
  assert.match(textOf(findByClass(ready, 'ant-card-goal')), /Ship the colony/);
  assert.match(textOf(findByClass(ready, 'ant-card-bot')), /Open colony/);

  const open = findAllByClass(findByClass(ready, 'ant-card-bot'), 'ant-button')[0];
  open.props.onClick();
  assert.deepEqual(runtime.layout.selected, ['ant']);
  assert.equal(props.model.getSnapshot().selectedTeamId, 'team-1');

  await cleanup();
  await runtime.disposeEffects();
});

test('unread mail reaches the header and the panel without a pending release', async () => {
  const view = {
    lifecycle: 'running', cursor: 4,
    members: [{ memberId: 'member-1', status: 'active', sessionId: 's1' }],
    attempts: [],
    tasks: [{ taskId: 'task-1', state: 'running' }],
    releaseQueue: [],
    plan: { dependencies: [] },
    summary: { goal: 'Ship', counts: { running: 1 }, unread: { total: 3, toLead: 2, recent: [] } },
  };
  const remoteTeam = {
    async list() { return { ok: true, value: { teams: [{ teamId: 'team-1', goal: 'Ship', lifecycle: 'running', cursor: 4 }] } }; },
    async get(request) { return { ok: true, value: { ...view, teamId: request.teamId } }; },
    async dispatch() { return { ok: true, value: { outcome: 'committed' } }; },
  };
  const runtime = createClientContext(remoteTeam);
  const { plugin } = await loadClient();
  const cleanup = await plugin.apply(runtime.ctx);

  const header = runtime.registrations.find(item => item.options.name === 'conversation.session.header.actions');
  const headerProps = header.options.inject();
  header.component(headerProps);
  await new Promise(resolve => setImmediate(resolve));
  const glyph = findByClass(header.component(headerProps), 'ant-glyph');
  assert.equal(glyph.props['data-pending'], undefined, 'no release is pending');
  assert.equal(glyph.props['data-unread'], 3);
  assert.match(glyph.props.title, /3/);

  const panel = runtime.registrations.find(item => item.options.name === 'main');
  const panelProps = panel.options.inject();
  panel.component(panelProps);
  await new Promise(resolve => setImmediate(resolve));
  const metas = findAllByClass(panel.component(panelProps), 'ant-meta').map(textOf);
  assert.ok(metas.some(text => /unread|未读/i.test(text) && /3/.test(text)), 'the panel names the unread backlog: ' + metas.join(' | '));
  await cleanup();
});

test('clicking an ant hands that member to the inspection desk', async () => {
  const view = {
    lifecycle: 'running',
    cursor: 4,
    members: [{ memberId: 'member-1', name: 'worker-1', status: 'active', sessionId: 's1', model: 'fixture-model' }],
    attempts: [{ attemptId: 'attempt-1', taskId: 'task-3', memberId: 'member-1', state: 'running', generation: 1 }],
    tasks: [{ taskId: 'task-3', title: 'Ship the panel', state: 'running' }],
    plan: { dependencies: [] },
  };
  const { main, props, plan, runtime, cleanup } = await mountWithView(view);
  const ants = findAllByClass(plan, 'ant-ant');
  assert.equal(ants.length, 1);
  assert.equal(ants[0].props['aria-label'], 'worker-1');
  ants[0].props.onClick();
  assert.equal(props.model.getSnapshot().selectedMemberId, 'member-1');

  const rail = findByClass(renderDeep(main.component(props)), 'ant-inspector ant-rail');
  assert.match(textOf(rail), /worker-1/);
  const labels = findAllByClass(rail, 'ant-button').map(textOf);
  assert.ok(labels.includes('Pause attempt'), 'a running attempt can be paused: ' + labels.join(' | '));
  assert.ok(labels.includes('Take over'), 'a running attempt can be taken over: ' + labels.join(' | '));
  assert.ok(labels.includes('Terminate attempt'), 'a running attempt can be terminated: ' + labels.join(' | '));
  await cleanup();
  await runtime.disposeEffects();
});

test('focusing a chamber steps the other chambers back', async () => {
  const view = {
    lifecycle: 'running',
    cursor: 4,
    members: [],
    attempts: [],
    tasks: [{ taskId: 'task-1', state: 'pending' }],
    plan: { dependencies: [] },
  };
  const { main, props, plan, runtime, cleanup } = await mountWithView(view);
  const nursery = findAllByClass(plan, 'ant-chamber').find(chamber => chamber.props['data-stage'] === 'nursery');
  nursery.children[0].props.onClick();
  assert.equal(props.model.getSnapshot().selectedStage, 'nursery');
  assert.equal(planOf(main.component(props)).props['data-focus'], '');

  plan.props.onKeyDown({ key: 'Escape', currentTarget: { querySelector: () => null } });
  assert.equal(props.model.getSnapshot().selectedStage, undefined);
  assert.equal(planOf(main.component(props)).props['data-focus'], undefined);
  await cleanup();
  await runtime.disposeEffects();
});
