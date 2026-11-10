import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { z } from 'zod';

const root = path.resolve(import.meta.dirname, '../..');
const clientPath = path.join(root, 'client.js');

function fakeReact() {
  const hooks = new Map();
  const stack = [];
  let component = 'root';
  let cursor = 0;
  const enter = name => { stack.push([component, cursor]); component = name; cursor = 0; };
  const exit = () => { const [previous, index] = stack.pop() ?? ['root', 0]; component = previous; cursor = index; };
  return {
    enter,
    exit,
    createElement(type, props, ...children) {
      return { type, props: props ?? null, children };
    },
    useEffect(effect) {
      effect();
    },
    useMemo(factory) {
      return factory();
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
    useState(initial) {
      const key = component + ':' + cursor;
      cursor += 1;
      if (!hooks.has(key)) hooks.set(key, typeof initial === 'function' ? initial() : initial);
      return [hooks.get(key), next => { hooks.set(key, typeof next === 'function' ? next(hooks.get(key)) : next); }];
    },
    reset() { component = 'root'; cursor = 0; stack.length = 0; },
  };
}

function createStorage() {
  const items = new Map();
  return {
    items,
    getItem(key) { return items.has(key) ? items.get(key) : null; },
    setItem(key, value) { items.set(key, String(value)); },
    removeItem(key) { items.delete(key); },
  };
}

function createFakeDocument() {
  const listeners = [];
  const head = { children: [], appendChild(element) { head.children.push(element); } };
  return {
    head,
    listeners,
    createElement(tag) {
      return {
        tag,
        attributes: {},
        textContent: '',
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() {},
      };
    },
    querySelector() { return undefined; },
    addEventListener(type, listener) { listeners.push([type, listener]); },
    removeEventListener(type, listener) {
      const index = listeners.findIndex(item => item[0] === type && item[1] === listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    fire(type, event) {
      for (const item of [...listeners]) if (item[0] === type) item[1](event);
    },
  };
}

async function loadClient(react = fakeReact(), options = {}) {
  const source = await readFile(clientPath, 'utf8');
  const document = options.document ?? createFakeDocument();
  const storage = options.storage ?? createStorage();
  let registration;
  const windowListeners = [];
  const window = {
    innerWidth: 1200,
    localStorage: storage,
    addEventListener(type, listener) { windowListeners.push([type, listener]); },
    removeEventListener(type, listener) {
      const index = windowListeners.findIndex(item => item[0] === type && item[1] === listener);
      if (index >= 0) windowListeners.splice(index, 1);
    },
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
    document,
    setTimeout: () => 0,
  }, { filename: clientPath });
  assert.equal(registration?.id, '@zhuifengqug/dsh-ant');
  const plugin = registration.factory(specifier => {
    if (specifier === 'react') return react;
    if (specifier === 'zod') return { z };
    throw new Error(`unexpected client dependency: ${specifier}`);
  });
  return { plugin, source, document, storage };
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


function findAllByClass(node, className, hits = []) {
  if (Array.isArray(node)) { for (const child of node) findAllByClass(child, className, hits); return hits; }
  if (!node || typeof node !== 'object') return hits;
  const own = typeof node.props?.className === 'string' ? node.props.className.split(/\s+/) : [];
  if (own.includes(className)) hits.push(node);
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

function renderDeep(node, react) {
  if (Array.isArray(node)) return node.map(child => renderDeep(child, react));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.type === 'function') {
    const props = { ...(node.props ?? {}) };
    for (const child of node.children ?? []) {
      if (child === undefined || child === null) continue;
      props.children = child;
      break;
    }
    react.enter(node.type.name || 'anon');
    const output = node.type(props);
    react.exit();
    return renderDeep(output, react);
  }
  return { ...node, children: (node.children ?? []).map(child => renderDeep(child, react)) };
}

function buttonsIn(node, hits = []) {
  if (Array.isArray(node)) { for (const child of node) buttonsIn(child, hits); return hits; }
  if (!node || typeof node !== 'object') return hits;
  if (node.type === 'button') hits.push(node);
  for (const child of node.children ?? []) buttonsIn(child, hits);
  return hits;
}

function buttonWithText(node, text) {
  return buttonsIn(node).find(item => textOf(item).trim() === text);
}

const FIRST_VIEW = {
  teamId: 'team-1',
  goal: '铺玄驹面板',
  lifecycle: 'running',
  cursor: 7,
  halted: false,
  planConfirmed: true,
  planDigest: 'a'.repeat(64),
  leadMemberId: 'member-1',
  members: [
    { memberId: 'member-1', role: '队长', sessionMode: 'shared', sessionId: 'session-1', provider: 'deepseek', model: 'deepseek-v4', status: 'active' },
    { memberId: 'member-2', role: '工蚁', sessionMode: 'isolated', provider: 'moonshot', model: 'kimi-k2', status: 'active' },
  ],
  attempts: [{ taskId: 'task-a', memberId: 'member-1', state: 'running' }],
  tasks: [
    { taskId: 'task-a', title: '做面板', objective: '复刻上游', acceptance: ['像'], state: 'claimed', ownerMemberId: 'member-1' },
    { taskId: 'task-b', title: '写测试', objective: '覆盖面板', acceptance: ['全绿'], state: 'released', ownerMemberId: 'member-2' },
  ],
  plan: { planId: 'plan-1', dependencies: [{ taskId: 'task-b', blockedByTaskId: 'task-a' }] },
  mailbox: [{ mailId: 'mail-1' }],
};

const ARCHIVED_VIEW = {
  teamId: 'team-2',
  goal: '旧的队',
  lifecycle: 'archived',
  cursor: 12,
  halted: true,
  planConfirmed: true,
  planDigest: 'b'.repeat(64),
  members: [{ memberId: 'member-9', role: '队长', sessionMode: 'shared', sessionId: 'session-9' }],
  attempts: [],
  tasks: [],
  plan: { dependencies: [] },
  mailbox: [],
};

/** Mount both halves of the colony: the seat in the composer, the panel in the shell overlay. */
async function mountColony({ views = { 'team-1': FIRST_VIEW }, sessionId = 'session-1', groups = [] } = {}) {
  const calls = [];
  const items = Object.values(views).map(view => ({ teamId: view.teamId, goal: view.goal, lifecycle: view.lifecycle, cursor: view.cursor }));
  const remoteTeam = {
    async list(request) { calls.push(['list', request]); return { ok: true, value: { teams: items } }; },
    async get(request) {
      calls.push(['get', request]);
      const view = views[request.teamId];
      if (!view) return { ok: false, error: Object.assign(new Error('missing team'), { code: 'team/not-found' }) };
      return { ok: true, value: view };
    },
    async dispatch(request) {
      calls.push(['dispatch', request]);
      return { ok: true, value: { outcome: 'committed', requestId: request.requestId, teamId: request.teamId, lastEventSeq: 9 } };
    },
  };
  const react = fakeReact();
  const runtime = createClientContext(remoteTeam);
  runtime.services.modelDirectories = {
    directoryFor(id) {
      calls.push(['directoryFor', id]);
      return { async load() { calls.push(['load']); }, store: { getSnapshot: () => ({ groups }) } };
    },
  };
  const { plugin, source, document, storage } = await loadClient(react);
  const cleanup = await plugin.apply(runtime.ctx);
  const seat = runtime.registrations.find(item => item.options.name === 'conversation.input.left');
  const panel = runtime.registrations.find(item => item.options.name === 'shell.overlay');
  const seatProps = seat.options.inject(sessionId);
  const panelProps = panel.options.inject(undefined);
  const settle = async () => { for (let round = 0; round < 6; round += 1) await new Promise(resolve => setImmediate(resolve)); };
  let tree;
  const render = (component, props) => {
    react.enter(component.name || 'anon');
    const output = component(props);
    react.exit();
    return renderDeep(output, react);
  };
  const draw = () => {
    react.reset();
    tree = { seat: render(seat.component, seatProps), panel: render(panel.component, panelProps) };
    return tree;
  };
  const open = async () => {
    const first = draw();
    findByClass(first.seat, 'chatEntry').props.onClick();
    draw();
    await settle();
    return draw();
  };
  draw();
  await settle();
  draw();
  await settle();
  return {
    runtime, cleanup, calls, seat, panel, seatProps, panelProps, settle, source, document, storage, open,
    draw,
    get tree() { return tree; },
    dispatched: () => calls.filter(item => item[0] === 'dispatch').map(item => item[1]),
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
  assert.doesNotMatch(source, /bind\('main'/);
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
    async list(request) {
      calls.push(['list', request]);
      if (failList) {
        const error = new Error('cursor moved');
        error.code = 'team/stale-cursor';
        return { ok: false, error };
      }
      return { ok: true, value: { teams: [{ teamId: 'team-1', goal: 'Ship', lifecycle: 'running', cursor: 4 }] } };
    },
    async get(request) {
      calls.push(['get', request]);
      return { ok: true, value: { teamId: request.teamId, goal: 'Ship', lifecycle: 'running', cursor: 4, members: [], attempts: [], tasks: [], plan: { dependencies: [] } } };
    },
    async dispatch(request) {
      calls.push(['dispatch', request]);
      return { ok: true, value: { outcome: 'committed', requestId: request.requestId, teamId: request.teamId, lastEventSeq: 8 } };
    },
  };
  const runtime = createClientContext(remoteTeam);
  const { plugin } = await loadClient();
  const cleanup = await plugin.apply(runtime.ctx);
  assert.equal(runtime.remote.mounted.package, '@zhuifengqug/dsh-ant');
  assert.deepEqual(runtime.registrations.map(item => [item.options.name, item.options.id, item.options.order]), [
    ['shell.overlay', 'ant', 80],
    ['conversation.input.left', 'ant', 10],
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
  assert.equal(props.model.getSnapshot().views['team-1'].cursor, 4);

  await props.model.dispatch('team-1', 'team.archive', {});
  assert.deepEqual(calls.slice(-2).map(item => item[0]), ['dispatch', 'get']);
  assert.equal(props.model.getSnapshot().receipt.outcome, 'committed');

  failList = true;
  await props.model.loadAll();
  assert.equal(props.model.getSnapshot().status, 'stale-cursor');
  assert.equal(props.model.getSnapshot().error.code, 'team/stale-cursor');

  await cleanup();
  const order = runtime.disposeOrder.slice(0, 4);
  assert.deepEqual(order.slice(0, 2), ['ant', 'ant']);
  assert.ok(runtime.disposeOrder.includes('follow'));
  assert.deepEqual(runtime.disposeOrder.slice(-2), ['follow', 'remote']);
  await runtime.disposeEffects();
  assert.equal(runtime.remoteUnmounts, 1);
  assert.equal(runtime.localeRegistrations, 0);
  assert.equal(runtime.localeSubscriptions, 0);
});

test('the seat sits beside the permission chip and one click docks the colony card', async () => {
  const colony = await mountColony();
  const seatButton = findByClass(colony.tree.seat, 'chatEntry');
  assert.equal(seatButton.props['aria-expanded'], 'false');
  assert.equal(seatButton.props['aria-haspopup'], 'dialog');
  assert.match(textOf(seatButton), /铺玄驹面板/);
  assert.equal(textOf(findByClass(colony.tree.seat, 'chatEntryCount')), '1', 'one task is running');
  assert.equal(colony.tree.panel, null, 'nothing is docked while the seat is shut');

  const opened = await colony.open();
  assert.equal(findByClass(opened.seat, 'chatEntry').props['aria-expanded'], 'true');
  const panel = findByClass(opened.panel, 'panel');
  assert.ok(panel, 'the panel docks inside the shell overlay');
  assert.equal(panel.props.role, 'dialog');
  assert.equal(panel.props['data-ant-panel'], 'true');
  assert.equal(panel.props.style.position, 'absolute');
  assert.match(textOf(findByClass(panel, 'teamName')), /铺玄驹面板/);
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('the panel lists every team and folds the archived ones under their label', async () => {
  const colony = await mountColony({ views: { 'team-1': FIRST_VIEW, 'team-2': ARCHIVED_VIEW } });
  const tree = await colony.open();
  const panel = findByClass(tree.panel, 'panel');
  assert.equal(findAllByClass(panel, 'team').length, 2);
  assert.match(textOf(findAllByClass(panel, 'teamStats')[0]), /Members|成员/);
  const label = findByClass(panel, 'archiveLabel');
  assert.ok(label, 'archived teams get a divider');
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('the dependency map draws one node per task and an edge per dependency', async () => {
  const colony = await mountColony();
  const tree = await colony.open();
  const panel = findByClass(tree.panel, 'panel');
  assert.equal(findAllByClass(panel, 'dagNode').length, 2);
  const edges = findAllByClass(panel, 'dagEdges')[0];
  const paths = (edges.children ?? []).flat().filter(Boolean);
  assert.equal(paths.length, 1, 'one dependency, one edge');
  assert.match(paths[0].props.d, /^M[\d.]+ [\d.]+C/);
  const detail = findByClass(panel, 'taskDetail');
  assert.equal(detail.props['data-task-detail'], 'task-a', 'the running task is the default detail');
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('a member model chip lists the Host catalogue and dispatches the picked pair', async () => {
  const groups = [{ id: 'moonshot', models: [{ id: 'kimi-k2' }, { id: 'kimi-k3' }] }];
  const colony = await mountColony({ groups });
  await colony.open();
  const chip = findAllByClass(colony.tree.panel, 'memberModel')[0];
  assert.match(textOf(chip), /deepseek\/deepseek-v4/);
  assert.equal(findAllByClass(colony.tree.panel, 'planModelPick').length, 0, 'the list stays folded until asked');
  chip.props.onClick();
  colony.draw();
  await colony.settle();
  colony.draw();
  assert.deepEqual(colony.calls.find(item => item[0] === 'directoryFor'), ['directoryFor', 'session-1']);
  const picks = findAllByClass(colony.tree.panel, 'planModelPick');
  assert.equal(picks.length, 2);
  picks[1].props.onClick();
  const dispatched = colony.dispatched();
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].action, 'member.changeModel');
  assert.equal(dispatched[0].teamId, 'team-1');
  assert.equal(dispatched[0].payload.memberId, 'member-1');
  assert.equal(dispatched[0].payload.provider, 'moonshot');
  assert.equal(dispatched[0].payload.model, 'kimi-k3');
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('a staged plan asks for confirmation before it can release anything', async () => {
  const view = { ...FIRST_VIEW, planConfirmed: false };
  const colony = await mountColony({ views: { 'team-1': view } });
  const tree = await colony.open();
  const confirm = buttonWithText(tree.panel, 'Confirm plan');
  assert.ok(confirm, 'the confirm button is the only way out of a staged plan');
  assert.equal(confirm.props.disabled, false);
  assert.equal(buttonWithText(tree.panel, 'Releasing'), undefined, 'nothing is released before the plan is confirmed');
  confirm.props.onClick();
  const dispatched = colony.dispatched();
  assert.equal(dispatched[0].action, 'plan.confirm');
  assert.equal(dispatched[0].payload.planDigest, 'a'.repeat(64));
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('a confirmed plan releases the ready batch from the card', async () => {
  const colony = await mountColony();
  const tree = await colony.open();
  const release = buttonWithText(tree.panel, 'Releasing');
  assert.ok(release, 'the foot of the plan releases the batch');
  assert.equal(release.props.disabled, false);
  release.props.onClick();
  const dispatched = colony.dispatched();
  assert.equal(dispatched[0].action, 'batch.release');
  assert.equal(dispatched[0].payload.batchId, 'batch-8');
  assert.deepEqual(dispatched[0].payload.taskIds, ['task-a']);
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('the card adds a task and amends one without leaving the conversation', async () => {
  const colony = await mountColony();
  let tree = await colony.open();
  buttonWithText(tree.panel, 'Add task').props.onClick();
  tree = colony.draw();
  const inputs = findAllByClass(tree.panel, 'planInput');
  const areas = findAllByClass(tree.panel, 'planTextarea');
  assert.equal(inputs.length, 2, 'title and acceptance');
  assert.equal(areas.length, 1);
  const save = () => buttonsIn(findByClass(tree.panel, 'planApproveRow'))[0];
  assert.equal(save().props.disabled, true, 'an empty task is not dispatched');
  inputs[0].props.onChange({ target: { value: '写测试' } });
  tree = colony.draw();
  findAllByClass(tree.panel, 'planTextarea')[0].props.onChange({ target: { value: '覆盖面板' } });
  tree = colony.draw();
  findAllByClass(tree.panel, 'planInput')[1].props.onChange({ target: { value: '测试全绿；无告警' } });
  tree = colony.draw();
  assert.equal(save().props.disabled, false);
  save().props.onClick();
  const created = colony.dispatched();
  assert.equal(created[0].action, 'task.create');
  assert.equal(created[0].payload.task.title, '写测试');
  assert.equal(created[0].payload.task.objective, '覆盖面板');
  assert.equal(created[0].payload.task.acceptance.join('|'), '测试全绿|无告警');
  await colony.settle();

  tree = colony.draw();
  findByClass(tree.panel, 'planCardIdentity').props.onClick();
  tree = colony.draw();
  findAllByClass(tree.panel, 'planInput')[0].props.onChange({ target: { value: '改标题' } });
  tree = colony.draw();
  buttonsIn(findByClass(tree.panel, 'planApproveRow'))[0].props.onClick();
  const amended = colony.dispatched().at(-1);
  assert.equal(amended.action, 'task.amend');
  assert.equal(amended.payload.taskId, 'task-a');
  assert.equal(amended.payload.patch.title, '改标题');
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('the card can be dragged by its head and resized from the bottom edge', async () => {
  const colony = await mountColony();
  const tree = await colony.open();
  const head = findByClass(tree.panel, 'panelHead');
  assert.equal(typeof head.props.onPointerDown, 'function');
  head.props.onPointerDown({ button: 0, clientX: 100, clientY: 100 });
  colony.document.fire('pointermove', { clientX: 140, clientY: 130 });
  colony.document.fire('pointerup', {});
  const moved = findByClass(colony.draw().panel, 'panel');
  assert.equal(moved.props.style.position, 'fixed');
  assert.equal(moved.props.style.left, 834);
  assert.equal(moved.props.style.top, 94);

  const grip = colony.draw().panel;
  const handle = findAllByClass(grip, 'resizeHandle')[0];
  handle.props.onPointerDown({ button: 0, clientX: 300, clientY: 300 });
  colony.document.fire('pointermove', { clientX: 400, clientY: 400 });
  colony.document.fire('pointerup', {});
  const resized = findByClass(colony.draw().panel, 'panel');
  assert.equal(resized.props.style.width, 488);
  assert.equal(resized.props.style.height, 660);
  const stored = JSON.parse(colony.storage.getItem('ant:panel:v1'));
  assert.deepEqual(stored, { x: 834, y: 94, width: 488, height: 660 });
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('a conversation that owns no team still reaches every team', async () => {
  const colony = await mountColony({ views: { 'team-1': FIRST_VIEW, 'team-2': ARCHIVED_VIEW }, sessionId: 'session-99' });
  const entry = findByClass(colony.tree.seat, 'chatEntry');
  assert.ok(entry, 'one card reaches every team, so the seat stays put');
  assert.match(textOf(entry), /玄驹/);
  const tree = await colony.open();
  assert.equal(findAllByClass(tree.panel, 'team').length, 2, 'both the live team and the archived one are listed');
  await colony.cleanup();
  await colony.runtime.disposeEffects();
});

test('the sheet is one scoped install and uses host tokens only', async () => {
  const { plugin, source } = await loadClient();
  assert.equal(typeof plugin.apply, 'function');
  assert.match(source, /document\.head\.appendChild\(element\)/, 'the sheet is installed once the plugin applies');
  assert.doesNotMatch(source, /function StyleSheet\(\)/);
  assert.match(source, /\[data-ant-ui\] \.panel\{/);
  assert.match(source, /\[data-ant-ui\] \.chatEntry\{/);
  assert.match(source, /border-radius: 16px/);
  assert.match(source, /prefers-reduced-motion: ?reduce/);
  assert.match(source, /PANEL_MIN_WIDTH = 320/);
  assert.match(source, /PANEL_MIN_HEIGHT = 360/);
  assert.doesNotMatch(source, /\.ant-seat|ant-nest|ant-chamber|ant-pop|ant-rail/);
  assert.doesNotMatch(source, /background:#[0-9a-f]{3,6}/i, 'no hard-coded colour survives the theme switch');
});
