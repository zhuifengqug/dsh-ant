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

async function loadClient(react = fakeReact(), extra = {}) {
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
    ...extra,
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
  const services = {};
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
    get(name) { return services[name]; },
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
    child.layout = layout;
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
    services,
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
  assert.match(source, /id: PANEL_ID/);
  assert.match(source, /'shell\.overlay'/);
  assert.match(source, /'conversation\.input\.left'/);
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

test('client apply mounts the panel and its seat, then disposes in reverse order', async () => {
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
    ['shell.overlay', 'ant'],
    ['conversation.input.left', 'ant'],
  ]);
  assert.equal(runtime.localeRegistrations, 1);
  assert.equal(runtime.localeSubscriptions, 1);

  const seat = runtime.registrations.find(item => item.options.name === 'conversation.input.left');
  const props = seat.options.inject('session-1');
  seat.component(props);
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
    'ant', 'ant', 'locale-subscription', 'locale', 'follow', 'remote',
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
  const seat = runtime.registrations.find(item => item.options.name === 'conversation.input.left');
  const props = seat.options.inject('session-1');
  seat.component(props);
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

const SEAT_VIEW = {
  goal: 'Ship the panel',
  lifecycle: 'running',
  cursor: 7,
  members: [
    { memberId: 'member-1', name: '工蚁 1', status: 'active', provider: 'deepseek', model: 'deepseek-v4', sessionId: 'session-1' },
  ],
  attempts: [],
  tasks: [{ taskId: 'task-a', title: '面板', state: 'reviewed' }],
  plan: { dependencies: [] },
  releaseQueue: [{ taskId: 'task-a', title: '面板' }],
  summary: { unread: { total: 2, toLead: 1, recent: [] } },
};

/** Mount both halves of the colony: the seat in the composer, the panel in the shell overlay. */
async function mountColony({ view = SEAT_VIEW, groups = [], sessionId = 'session-1' } = {}) {
  const calls = [];
  const remoteTeam = {
    async list() { return { ok: true, value: { teams: [{ teamId: 'team-1', goal: view.goal, lifecycle: view.lifecycle, cursor: view.cursor }] } }; },
    async get(request) { return { ok: true, value: { ...view, teamId: request.teamId } }; },
    async dispatch(request) { calls.push(['dispatch', request]); return { ok: true, value: { outcome: 'committed', requestId: request.requestId, teamId: request.teamId, lastEventSeq: 9 } }; },
  };
  const react = fakeReact();
  const runtime = createClientContext(remoteTeam);
  runtime.services.modelDirectories = {
    directoryFor(sessionId) {
      calls.push(['directoryFor', sessionId]);
      return { async load() { calls.push(['load']); }, store: { getSnapshot: () => ({ groups }) } };
    },
  };
  const { plugin } = await loadClient(react);
  const cleanup = await plugin.apply(runtime.ctx);
  const seat = runtime.registrations.find(item => item.options.name === 'conversation.input.left');
  const panel = runtime.registrations.find(item => item.options.name === 'shell.overlay');
  const seatProps = seat.options.inject(sessionId);
  const panelProps = panel.options.inject('session-1');
  const settle = async () => { for (let round = 0; round < 4; round += 1) await new Promise(resolve => setImmediate(resolve)); };
  const draw = () => { react.reset(); return { seat: seat.component(seatProps), panel: panel.component(panelProps) }; };
  draw();
  await settle();
  let tree = draw();
  return {
    runtime, cleanup, calls, seat, panel, seatProps, panelProps, settle,
    draw: () => { tree = draw(); return tree; },
    get tree() { return tree; },
  };
}

test('the seat sits beside the permission chip and folds the whole colony behind one click', async () => {
  const colony = await mountColony();
  assert.deepEqual(colony.runtime.registrations.map(item => [item.options.name, item.options.id, item.options.order]), [
    ['shell.overlay', 'ant', 80],
    ['conversation.input.left', 'ant', 10],
  ]);
  const button = findByClass(colony.tree.seat, 'ant-seat');
  assert.equal(button.props['data-ant-seat'], '');
  assert.equal(button.props['aria-expanded'], 'false');
  assert.equal(button.props['aria-haspopup'], 'dialog');
  assert.equal(textOf(button).replace(/\d/g, ''), 'Ant', 'the seat reads the same at rest: ' + textOf(button));
  assert.equal(textOf(findByClass(colony.tree.seat, 'ant-seat-count')), '1', 'the pending batch is the badge');
  assert.equal(colony.tree.panel, null, 'nothing is docked while the seat is shut');

  findByClass(colony.tree.seat, 'ant-seat').props.onClick();
  const opened = colony.draw();
  assert.equal(findByClass(opened.seat, 'ant-seat').props['aria-expanded'], 'true');
  const panel = findByClass(opened.panel, 'ant-panel');
  assert.ok(panel, 'the panel docks inside the shell overlay');
  assert.equal(panel.props.role, 'dialog');
  assert.equal(panel.props['data-ant-panel'], '');
  assert.match(textOf(findByClass(panel, 'ant-panel-goal')), /Ship the panel/);
  const rows = findAllByClass(panel, 'ant-row');
  assert.match(textOf(rows[0]), /工蚁 1/);
  assert.match(textOf(rows[0]), /idle/);
  assert.match(textOf(rows[1]), /ready to release/);
  assert.equal(findAllByClass(panel, 'ant-panel').length, 1, 'the panel never nests a second panel');
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('another team\'s conversation gets no seat at all', async () => {
  const colony = await mountColony({ sessionId: 'session-9' });
  assert.equal(colony.tree.seat, null, 'the seat belongs to the team\'s own sessions');
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('a member model chip lists the Host catalogue and dispatches the picked pair', async () => {
  const groups = [{ id: 'deepseek', models: [{ id: 'deepseek-v4', label: 'DeepSeek V4' }, { id: 'deepseek-v4-thinking', label: 'DeepSeek V4 Thinking' }] }];
  const colony = await mountColony({ groups });
  findByClass(colony.tree.seat, 'ant-seat').props.onClick();
  colony.draw();

  const chip = findByClass(colony.tree.panel, 'ant-chip');
  assert.equal(chip.props['data-member'], 'member-1');
  assert.equal(chip.props['aria-expanded'], 'false');
  assert.equal(textOf(chip), 'deepseek-v4 ▾');
  assert.equal(findAllByClass(colony.tree.panel, 'ant-model-pick').length, 0, 'the list stays folded until asked');

  chip.props.onClick();
  colony.draw();
  await colony.settle();
  const tree = colony.draw();
  assert.deepEqual(colony.calls.find(item => item[0] === 'directoryFor'), ['directoryFor', 'session-1']);
  const picks = findAllByClass(tree.panel, 'ant-model-pick');
  assert.equal(picks.length, 2);
  assert.equal(picks[0].props['aria-pressed'], 'true');
  assert.equal(picks[1].props['aria-pressed'], 'false');

  picks[1].props.onClick();
  const dispatched = colony.calls.filter(item => item[0] === 'dispatch').map(item => item[1]);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].action, 'member.changeModel');
  assert.equal(dispatched[0].payload.memberId, 'member-1');
  assert.equal(dispatched[0].payload.provider, 'deepseek');
  assert.equal(dispatched[0].payload.model, 'deepseek-v4-thinking');
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('the panel releases the pending batch from the footer', async () => {
  const colony = await mountColony();
  findByClass(colony.tree.seat, 'ant-seat').props.onClick();
  const tree = colony.draw();
  const release = findByClass(tree.panel, 'ant-primary');
  assert.equal(release.props.disabled, false);
  assert.match(textOf(release), /1/);
  release.props.onClick();
  const dispatched = colony.calls.filter(item => item[0] === 'dispatch').map(item => item[1]);
  assert.equal(dispatched[0].action, 'batch.release');
  assert.equal(dispatched[0].payload.batchId, 'batch-8');
  assert.deepEqual(dispatched[0].payload.taskIds, ['task-a']);
  assert.match(textOf(findByClass(tree.panel, 'ant-panel-foot')), /2/);
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('the close button shuts the panel without leaving the conversation', async () => {
  const colony = await mountColony();
  findByClass(colony.tree.seat, 'ant-seat').props.onClick();
  const opened = colony.draw();
  findByClass(opened.panel, 'ant-icon').props.onClick();
  const shut = colony.draw();
  assert.equal(shut.panel, null);
  assert.equal(findByClass(shut.seat, 'ant-seat').props['aria-expanded'], 'false');
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('the panel is a docked card, never a page, and uses host tokens only', async () => {
  const { plugin, source } = await loadClient();
  assert.equal(typeof plugin.apply, 'function');
  assert.match(source, /\.ant-seat\{[^}]*height:28px/);
  assert.match(source, /\.ant-seat\{[^}]*border:1px solid var\(--dsw-alias-border-l2\)/);
  assert.match(source, /\.ant-panel\{[^}]*position:absolute/);
  assert.match(source, /\.ant-panel\{[^}]*top:var\(--dsh-frame-overlay-top,74px\)/);
  assert.match(source, /\.ant-panel\{[^}]*right:16px/);
  assert.match(source, /@keyframes ant-panel-in/);
  assert.match(source, /document\.head\.appendChild\(element\)/, 'the sheet is installed once the plugin applies');
  assert.doesNotMatch(source, /function StyleSheet\(\)/);
  assert.match(source, /@media \(prefers-reduced-motion: ?reduce\)/);
  assert.doesNotMatch(source, /ant-nest|ant-chamber|ant-pop|ant-rail/);
  assert.doesNotMatch(source, /bind\('main'/);
  assert.doesNotMatch(source, /background:#[0-9a-f]{3,6}/i, 'no hard-coded colour survives the theme switch');
});
