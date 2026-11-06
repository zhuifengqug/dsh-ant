window.__ModuleLoader__.load({
  id: '@zhuifengqug/dsh-ant',
  factory(require) {
    const React = require('react');
    const zodModule = require('zod');
    const z = zodModule.z ?? zodModule;
    const h = React.createElement;
    const PACKAGE = '@zhuifengqug/dsh-ant';
    const REMOTE_SERVICE = 'ant';
    const LOCALE_NS = 'ant';
    const PANEL_ID = 'ant';

    function codec(typeSymbol, create, jsonSchema) {
      return { mode: 'strict', typeSymbol, create, jsonSchema };
    }

    class NamedInput {
      constructor(parameters, strict, zodRuntime) {
        this.parameters = parameters;
        this.strict = strict;
        this.zod = zodRuntime;
        this.schema = undefined;
      }
      create() {
        if (this.schema) return this.schema;
        const values = Object.fromEntries(this.parameters.map(parameter => [
          parameter.wire,
          (this.strict ? parameter.strictCodec : parameter.codec).create(),
        ]));
        this.schema = this.zod.strictObject(values);
        return this.schema;
      }
    }

    class RemoteInfo {
      constructor(spec, zodRuntime) {
        this.spec = spec;
        this.zod = zodRuntime;
        this.index = undefined;
      }
      get package() { return this.spec.package; }
      get descriptors() { return this.resolve().descriptors; }
      get methods() { return this.resolve().methods; }
      resolve() {
        if (this.index) return this.index;
        const descriptors = [];
        const methods = Object.create(null);
        for (const [endpoint, definition] of Object.entries(this.spec.methods)) {
          const separator = endpoint.indexOf('/');
          const namespace = endpoint.slice(0, separator);
          const method = endpoint.slice(separator + 1);
          const parameters = definition.parameters.map(parameter => ({
            ...parameter,
            wire: parameter.wire ?? parameter.name,
          }));
          const descriptor = {
            ...definition,
            id: `${this.spec.package}#${endpoint}`,
            namespace,
            method,
            parameters,
          };
          if (definition.invocation.kind === 'direct') {
            const inputs = [];
            descriptor.input = options => {
              const strict = options?.strict === true;
              return inputs[strict ? 1 : 0] ??= new NamedInput(parameters, strict, this.zod);
            };
            descriptor.invoke = (remote, input, signal) => {
              const args = parameters.map(parameter => input[parameter.wire]);
              if (definition.cancellation) args.push(signal);
              const receiver = Reflect.get(remote, namespace);
              return Reflect.get(receiver, method).apply(receiver, args);
            };
            methods[endpoint] = descriptor;
          }
          descriptors.push(descriptor);
        }
        this.index = { descriptors, methods };
        return this.index;
      }
    }

    const requestSchema = z.record(z.string(), z.unknown());
    const resultSchema = z.record(z.string(), z.unknown());
    const getSchema = z.strictObject({
      teamId: z.string().min(1),
      atLeastEventSeq: z.number().int().nonnegative().optional(),
    });
    const listSchema = z.strictObject({
      includeArchived: z.boolean().optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    });
    const openObject = { type: 'object', additionalProperties: true };
    const strictGet = {
      type: 'object',
      properties: {
        teamId: { type: 'string', minLength: 1 },
        atLeastEventSeq: { type: 'integer', minimum: 0 },
      },
      required: ['teamId'],
      additionalProperties: false,
    };
    const strictList = {
      type: 'object',
      properties: {
        includeArchived: { type: 'boolean' },
        cursor: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    };
    const TEAM_REMOTE = new RemoteInfo({
      package: PACKAGE,
      methods: {
        'team/dispatch': {
          service: REMOTE_SERVICE,
          implementation: 'dispatch',
          invocation: { kind: 'direct' },
          parameters: [{
            name: 'request', source: 'json',
            codec: codec(`${PACKAGE}/types#TeamDispatchRequest`, () => requestSchema, openObject),
            strictCodec: codec(`${PACKAGE}/types#TeamDispatchRequest`, () => requestSchema, openObject),
          }],
          result: codec(`${PACKAGE}/types#TeamDispatchReceipt`, () => resultSchema, openObject),
          cancellation: { parameter: 'signal' },
        },
        'team/get': {
          service: REMOTE_SERVICE,
          implementation: 'get',
          invocation: { kind: 'direct' },
          parameters: [{
            name: 'request', source: 'json',
            codec: codec(`${PACKAGE}/types#TeamGetRequest`, () => getSchema, { ...strictGet, additionalProperties: true }),
            strictCodec: codec(`${PACKAGE}/types#TeamGetRequest`, () => getSchema, strictGet),
          }],
          result: codec(`${PACKAGE}/types#TeamView`, () => resultSchema, openObject),
          cancellation: { parameter: 'signal' },
        },
        'team/list': {
          service: REMOTE_SERVICE,
          implementation: 'list',
          invocation: { kind: 'direct' },
          parameters: [{
            name: 'request', source: 'json',
            codec: codec(`${PACKAGE}/types#TeamListRequest`, () => listSchema, { ...strictList, additionalProperties: true }),
            strictCodec: codec(`${PACKAGE}/types#TeamListRequest`, () => listSchema, strictList),
          }],
          result: codec(`${PACKAGE}/types#TeamListResult`, () => resultSchema, openObject),
          cancellation: { parameter: 'signal' },
        },
      },
    }, z);

    const DICT = {
      en: {
        panel: 'Ant', title: 'Amber Ant', subtitle: 'Durable multi-session collaboration', refresh: 'Refresh',
        loading: 'Loading team facts', refreshing: 'Refreshing', empty: 'No teams in this workspace',
        emptyHint: 'Create a team from the Host action surface, then refresh this panel.', team: 'Team', lifecycle: 'Lifecycle', cursor: 'Fact cursor',
        members: 'Members', attempts: 'Attempts', tasks: 'Tasks', compass: 'Orbit compass', inspector: 'Inspection desk',
        noSelection: 'Select a task or attempt to inspect it.', unknown: 'Unknown', owner: 'Owner', model: 'Model', state: 'State',
        dependencies: 'Dependencies', quality: 'Quality gates', confirmPlan: 'Confirm plan', pause: 'Pause attempt', resume: 'Resume attempt',
        terminate: 'Terminate attempt', archive: 'Archive team', restore: 'Restore team', dispatching: 'Dispatching', committed: 'Committed',
        duplicate: 'Duplicate', error: 'Action failed', stale: 'Facts moved forward; refresh before retrying.', unavailable: 'Host is unavailable. Last known facts remain visible.',
        notFound: 'Team was not found. Refresh the list.', rebuild: 'The read model needs rebuilding. Refresh the facts.', lease: 'The writer lease is unavailable.',
        persistence: 'The receipt was not persisted.', inner: 'Members', middle: 'Attempts', outer: 'Tasks',
      },
      zh: {
        panel: '玄驹', title: '虫珀·玄驹', subtitle: '多会话协作持久事实面', refresh: '刷新', loading: '正在读取团队事实', refreshing: '正在刷新',
        empty: '当前工作区暂无团队', emptyHint: '请先从 Host 动作入口创建团队，再刷新此面板。', team: '团队', lifecycle: '生命周期', cursor: '事实游标',
        members: '成员', attempts: 'Attempt', tasks: '任务', compass: '轨道罗盘', inspector: '任务检查台', noSelection: '选择任务或 Attempt 查看事实。',
        unknown: '未知', owner: '负责人', model: '模型', state: '状态', dependencies: '依赖', quality: '质量门', confirmPlan: '确认计划',
        pause: '暂停 Attempt', resume: '恢复 Attempt', terminate: '终止 Attempt', archive: '归档团队', restore: '恢复团队', dispatching: '正在派发',
        committed: '已提交', duplicate: '重复请求', error: '动作失败', stale: '事实已前进，请刷新后重试。', unavailable: 'Host 暂不可用，仍保留最后已知事实。',
        notFound: '团队不存在，请刷新列表。', rebuild: '读面需要重建，请刷新事实。', lease: '写入租约不可用。', persistence: '回执未持久化。',
        inner: '成员', middle: 'Attempt', outer: '任务',
      },
    };

    const CSS = `
      .ant-shell{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit}
      .ant-shell *{box-sizing:border-box}.ant-header{display:grid;grid-template-columns:minmax(200px,1fr) auto auto auto;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .ant-title{margin:0;font-size:18px;line-height:1.25;font-weight:700}.ant-subtitle{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}
      .ant-meta,.ant-select-label{display:flex;flex-direction:column;gap:4px;color:var(--dsw-alias-label-secondary);font-size:11px}.ant-select,.ant-button{min-height:34px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}.ant-select{min-width:180px;padding:0 10px}.ant-button{padding:0 12px;cursor:pointer}.ant-button:hover{border-color:var(--dsw-alias-brand-primary)}
      .ant-button:focus-visible,.ant-select:focus-visible,.ant-node:focus-visible,.ant-team-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.ant-button[disabled]{cursor:wait;opacity:.55}
      .ant-body{display:grid;grid-template-columns:minmax(176px,220px) minmax(360px,1fr) minmax(250px,320px);min-height:0;flex:1}.ant-index,.ant-inspector{min-width:0;overflow:auto;padding:16px;background:var(--dsw-alias-bg-layer-1)}.ant-index{border-right:1px solid var(--dsw-alias-border-l1)}.ant-inspector{border-left:1px solid var(--dsw-alias-border-l1)}
      .ant-section-title{margin:0 0 10px;font-size:12px;font-weight:700;color:var(--dsw-alias-label-secondary);text-transform:uppercase}.ant-team-row{display:block;width:100%;padding:10px;margin:0 0 6px;border:1px solid transparent;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer}.ant-team-row:hover{background:var(--dsw-alias-bg-layer-2)}.ant-team-row[aria-current=true]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
      .ant-team-id{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}.ant-team-goal{display:block;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11px}.ant-team-state{display:flex;justify-content:space-between;gap:8px;margin-top:7px;color:var(--dsw-alias-label-secondary);font-size:10px}
      .ant-orbit{min-width:0;overflow:auto;padding:16px;background:var(--dsw-alias-bg-base)}.ant-orbit-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.ant-counts{display:flex;flex-wrap:wrap;gap:6px}.ant-chip{display:inline-flex;align-items:center;min-height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
      .ant-stage{position:relative;min-height:440px;overflow:hidden;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}.ant-orbit-svg{position:absolute;inset:18px;width:calc(100% - 36px);height:calc(100% - 36px)}.ant-ring{fill:none;stroke:var(--dsw-alias-border-l1);stroke-width:1}.ant-ring-accent{fill:none;stroke:var(--dsw-alias-brand-primary);stroke-width:1;stroke-dasharray:3 7;opacity:.7}.ant-link{stroke:var(--dsw-alias-border-l2);stroke-width:1.5;opacity:.85}
      .ant-node{position:absolute;transform:translate(-50%,-50%);min-width:76px;max-width:128px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer}.ant-node[data-layer=member]{border-color:var(--dsw-alias-state-success-primary)}.ant-node[data-layer=attempt]{border-color:var(--dsw-alias-state-warn-primary)}.ant-node[data-layer=task]{border-color:var(--dsw-alias-brand-primary)}.ant-node[aria-pressed=true]{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.ant-node-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:700}.ant-node-state{display:block;margin-top:3px;color:var(--dsw-alias-label-secondary);font-size:10px}
      .ant-legend{display:flex;flex-wrap:wrap;gap:12px;padding-top:10px;color:var(--dsw-alias-label-secondary);font-size:11px}.ant-legend span{display:inline-flex;align-items:center;gap:5px}.ant-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-brand-primary)}.ant-dot.member{background:var(--dsw-alias-state-success-primary)}.ant-dot.attempt{background:var(--dsw-alias-state-warn-primary)}
      .ant-facts{display:grid;gap:8px;margin:0 0 16px}.ant-fact{display:grid;grid-template-columns:minmax(80px,auto) 1fr;gap:8px;border-bottom:1px solid var(--dsw-alias-border-l1);padding-bottom:7px;font-size:12px}.ant-fact dt{color:var(--dsw-alias-label-secondary)}.ant-fact dd{margin:0;overflow-wrap:anywhere}.ant-actions{display:grid;gap:8px;margin-top:14px}.ant-actions .ant-button{width:100%;text-align:left}.ant-status{margin:0 0 12px;padding:9px 10px;border-left:3px solid var(--dsw-alias-state-idle-primary);background:var(--dsw-alias-bg-layer-2);font-size:12px}.ant-status.error{border-left-color:var(--dsw-alias-state-error-primary)}.ant-status.success{border-left-color:var(--dsw-alias-state-success-primary)}.ant-status.warn{border-left-color:var(--dsw-alias-state-warn-primary)}.ant-empty,.ant-loading{display:grid;place-items:center;min-height:220px;padding:24px;color:var(--dsw-alias-label-secondary);text-align:center}.ant-empty strong{display:block;margin-bottom:6px;color:var(--dsw-alias-label-primary)}.ant-member-list{display:grid;gap:6px;margin-top:12px}.ant-member{padding:8px;border-left:2px solid var(--dsw-alias-state-idle-primary);background:var(--dsw-alias-bg-layer-2)}.ant-member strong{display:block;font-size:12px}.ant-member small,.ant-note{color:var(--dsw-alias-label-secondary);font-size:11px}
      @media(max-width:1024px){.ant-body{grid-template-columns:minmax(160px,190px) minmax(320px,1fr)}.ant-inspector{grid-column:1/-1;border-top:1px solid var(--dsw-alias-border-l1);border-left:0}}
      @media(max-width:768px){.ant-header{grid-template-columns:1fr auto}.ant-header .ant-meta{display:none}.ant-body{display:flex;flex-direction:column}.ant-index{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1);max-height:190px}.ant-orbit{order:2}.ant-inspector{order:3;border-top:1px solid var(--dsw-alias-border-l1)}.ant-stage{min-height:390px}}
      @media(max-width:420px){.ant-header{padding:12px;gap:8px}.ant-header .ant-select-label{grid-column:1/-1}.ant-orbit,.ant-index,.ant-inspector{padding:12px}.ant-stage{min-height:340px}.ant-node{min-width:66px;max-width:92px;padding:6px}}
    `;

    function createLocale(ctx) {
      const listeners = new Set();
      let revision = 0;
      const unsubscribe = typeof ctx.locale.subscribe === 'function'
        ? ctx.locale.subscribe(() => { revision += 1; listeners.forEach(listener => listener()); })
        : () => {};
      const active = () => ctx.locale.getSnapshot?.().active ?? 'zh';
      return {
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        snapshot() { return `${active()}:${revision}`; },
        t(key) { const language = active().toLowerCase().startsWith('zh') ? 'zh' : 'en'; return DICT[language][key] ?? DICT.en[key] ?? key; },
        dispose: unsubscribe,
      };
    }

    function normalizeError(error) {
      return { code: error?.code ?? error?.details?.code ?? 'team/unavailable', message: error?.message ?? 'Team action failed', details: error?.details ?? {} };
    }
    function statusForError(error) {
      if (error.code === 'team/not-found') return 'not-found';
      if (error.code === 'team/stale-cursor') return 'stale-cursor';
      if (error.code === 'team/lease-conflict' || error.code === 'team/lease-lost') return 'lease';
      if (error.code === 'team/rebuild-required') return 'rebuild-required';
      if (error.code === 'team/persistence-failed') return 'persistence-failed';
      return 'unavailable';
    }
    function makeRequestId() { return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
    function shortId(value) { const text = String(value ?? 'unknown'); return text.length > 13 ? `${text.slice(0, 5)}…${text.slice(-5)}` : text; }
    function polar(count, index, radius) { if (!count) return { x: 50, y: 50 }; const angle = -Math.PI / 2 + index / count * Math.PI * 2; return { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius * .78 }; }

    function unwrapRemoteResult(result) {
      if (result?.ok === true) return result.value;
      if (result?.ok === false) throw result.error;
      throw new Error('Client Remote returned an invalid result envelope');
    }

    function createController(remote) {
      let state = { status: 'loading', teams: [], selectedTeamId: undefined, view: undefined, selectedTaskId: undefined, selectedAttemptId: undefined, selectedMemberId: undefined, request: undefined, receipt: undefined, error: undefined };
      const listeners = new Set();
      let sequence = 0;
      let controller;
      let disposed = false;
      const emit = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
      const nextSignal = () => { controller?.abort(); controller = new AbortController(); return controller.signal; };
      const read = async (teamId, atLeastEventSeq) => unwrapRemoteResult(await remote.get({ teamId, ...(atLeastEventSeq === undefined ? {} : { atLeastEventSeq }) }, nextSignal()));
      const loadView = async (teamId, atLeastEventSeq) => {
        if (!teamId || disposed) return;
        const current = sequence;
        emit({ status: state.view ? 'refreshing' : 'loading', selectedTeamId: teamId, error: undefined });
        try { const view = await read(teamId, atLeastEventSeq); if (!disposed && current === sequence) emit({ status: 'ready', view, error: undefined }); }
        catch (error) { if (!disposed && current === sequence) { const normalized = normalizeError(error); emit({ status: statusForError(normalized), error: normalized, view: normalized.code === 'team/not-found' ? undefined : state.view }); } }
      };
      const loadList = async () => {
        const current = ++sequence;
        emit({ status: state.view ? 'refreshing' : 'loading', error: undefined });
        try {
          const result = unwrapRemoteResult(await remote.list({ includeArchived: false, limit: 100 }, nextSignal()));
          if (disposed || current !== sequence) return;
          const teams = Array.isArray(result?.teams) ? result.teams : [];
          const selectedTeamId = teams.some(item => item.teamId === state.selectedTeamId) ? state.selectedTeamId : teams[0]?.teamId;
          emit({ teams, selectedTeamId, status: teams.length ? 'ready' : 'empty', error: undefined });
          if (selectedTeamId) await loadView(selectedTeamId);
        } catch (error) { if (!disposed && current === sequence) { const normalized = normalizeError(error); emit({ status: statusForError(normalized), error: normalized }); } }
      };
      const selectTeam = teamId => { emit({ selectedTeamId: teamId, selectedTaskId: undefined, selectedAttemptId: undefined, selectedMemberId: undefined }); return loadView(teamId); };
      const selectNode = (layer, id) => emit({ selectedTaskId: layer === 'task' ? id : state.selectedTaskId, selectedAttemptId: layer === 'attempt' ? id : state.selectedAttemptId, selectedMemberId: layer === 'member' ? id : state.selectedMemberId });
      const dispatch = async (action, payload) => {
        if (!state.selectedTeamId || state.request || disposed) return;
        const request = { requestId: makeRequestId(), teamId: state.selectedTeamId, action, payload };
        emit({ request, receipt: undefined, error: undefined });
        try { const receipt = unwrapRemoteResult(await remote.dispatch(request, nextSignal())); if (disposed) return; emit({ request: undefined, receipt }); await loadView(request.teamId, receipt?.lastEventSeq); }
        catch (error) { if (!disposed) { const normalized = normalizeError(error); emit({ request: undefined, status: statusForError(normalized), error: normalized }); } }
      };
      return { subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => state, loadList, selectTeam, selectNode, dispatch, dispose() { disposed = true; sequence += 1; controller?.abort(); listeners.clear(); } };
    }

    function useModel(model) { return React.useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot); }
    function useLocale(locale) { React.useSyncExternalStore(locale.subscribe, locale.snapshot, locale.snapshot); return locale; }
    function statusText(state, locale) {
      if (state.request) return h('p', { className: 'ant-status warn', role: 'status' }, `${locale.t('dispatching')} · ${state.request.action}`);
      if (state.error) { const message = state.status === 'stale-cursor' ? locale.t('stale') : state.status === 'lease' ? locale.t('lease') : state.status === 'rebuild-required' ? locale.t('rebuild') : state.status === 'persistence-failed' ? locale.t('persistence') : state.status === 'not-found' ? locale.t('notFound') : locale.t('unavailable'); return h('p', { className: 'ant-status error', role: 'alert' }, `${message} (${state.error.code})`); }
      if (state.receipt) return h('p', { className: 'ant-status success', role: 'status' }, `${state.receipt.outcome === 'duplicate' ? locale.t('duplicate') : locale.t('committed')} · ${state.receipt.requestId ?? locale.t('unknown')}`);
      return state.status === 'refreshing' ? h('p', { className: 'ant-status', role: 'status' }, locale.t('refreshing')) : null;
    }

    function Orbit({ state, locale, onSelect }) {
      const view = state.view ?? {};
      const members = [...(view.members ?? [])].sort((a, b) => String(a.memberId).localeCompare(String(b.memberId)));
      const attempts = [...(view.attempts ?? [])].sort((a, b) => Number(a.generation ?? 0) - Number(b.generation ?? 0) || String(a.attemptId).localeCompare(String(b.attemptId)));
      const tasks = [...(view.tasks ?? [])].sort((a, b) => String(a.taskId).localeCompare(String(b.taskId)));
      const points = { member: members.map((item, i) => ({ item, ...polar(members.length, i, 31) })), attempt: attempts.map((item, i) => ({ item, ...polar(attempts.length, i, 22) })), task: tasks.map((item, i) => ({ item, ...polar(tasks.length, i, 42) })) };
      const taskPoints = new Map(points.task.map(point => [point.item.taskId, point]));
      const links = (view.plan?.dependencies ?? []).map(dependency => ({ from: taskPoints.get(dependency.blockedByTaskId), to: taskPoints.get(dependency.taskId), key: `${dependency.blockedByTaskId}-${dependency.taskId}` })).filter(item => item.from && item.to);
      const node = (point, layer, id, label, item) => h('button', { key: id, type: 'button', className: 'ant-node', 'data-layer': layer, style: { left: `${point.x}%`, top: `${point.y}%` }, 'aria-pressed': (layer === 'task' ? state.selectedTaskId : layer === 'attempt' ? state.selectedAttemptId : state.selectedMemberId) === id, 'aria-label': `${label} ${item.title ?? id} ${item.state ?? item.status ?? locale.t('unknown')}`, onClick: () => onSelect(layer, id) }, h('span', { className: 'ant-node-name' }, layer === 'task' ? item.title ?? shortId(id) : shortId(id)), h('span', { className: 'ant-node-state' }, item.state ?? item.status ?? locale.t('unknown')));
      return h('div', { className: 'ant-stage', role: 'group', 'aria-label': locale.t('compass') },
        h('svg', { className: 'ant-orbit-svg', viewBox: '0 0 100 100', 'aria-hidden': 'true', preserveAspectRatio: 'none' }, h('circle', { className: 'ant-ring', cx: 50, cy: 50, r: 31 }), h('circle', { className: 'ant-ring', cx: 50, cy: 50, r: 22 }), h('circle', { className: 'ant-ring-accent', cx: 50, cy: 50, r: 42 }), links.map(link => h('line', { className: 'ant-link', key: link.key, x1: link.from.x, y1: link.from.y, x2: link.to.x, y2: link.to.y }))),
        points.member.map(point => node(point, 'member', point.item.memberId, locale.t('members'), point.item)), points.attempt.map(point => node(point, 'attempt', point.item.attemptId, locale.t('attempts'), point.item)), points.task.map(point => node(point, 'task', point.item.taskId, locale.t('tasks'), point.item)),
        h('div', { className: 'ant-legend' }, h('span', null, h('i', { className: 'ant-dot member' }), locale.t('inner')), h('span', null, h('i', { className: 'ant-dot attempt' }), locale.t('middle')), h('span', null, h('i', { className: 'ant-dot' }), locale.t('outer'))),
      );
    }

    function Index({ state, locale, onSelect }) {
      return h('aside', { className: 'ant-index', 'aria-label': locale.t('team') }, h('h2', { className: 'ant-section-title' }, locale.t('team')), state.teams.length ? state.teams.map(team => h('button', { key: team.teamId, type: 'button', className: 'ant-team-row', 'aria-current': state.selectedTeamId === team.teamId ? 'true' : undefined, onClick: () => onSelect(team.teamId) }, h('strong', { className: 'ant-team-id' }, shortId(team.teamId)), h('span', { className: 'ant-team-goal' }, team.goal ?? locale.t('unknown')), h('span', { className: 'ant-team-state' }, h('span', null, team.lifecycle ?? locale.t('unknown')), h('span', null, `${locale.t('cursor')} ${team.cursor ?? '?'}`)))) : h('p', { className: 'ant-note' }, locale.t('empty')), state.view?.members?.length ? h('div', { className: 'ant-member-list' }, state.view.members.filter(member => member.status !== 'removed').map(member => h('div', { className: 'ant-member', key: member.memberId }, h('strong', null, shortId(member.memberId)), h('small', null, `${member.role ?? locale.t('unknown')} · ${member.model ?? member.provider ?? locale.t('unknown')}`)))) : null);
    }

    function Inspector({ state, locale, dispatch }) {
      const view = state.view ?? {};
      const task = (view.tasks ?? []).find(item => item.taskId === state.selectedTaskId);
      const attempt = (view.attempts ?? []).find(item => item.attemptId === state.selectedAttemptId) ?? (task && (view.attempts ?? []).find(item => item.taskId === task.taskId));
      const member = (view.members ?? []).find(item => item.memberId === state.selectedMemberId) ?? (task && (view.members ?? []).find(item => item.memberId === task.ownerMemberId));
      const chosen = task ?? attempt ?? member;
      const rows = [[locale.t('lifecycle'), view.lifecycle], [locale.t('cursor'), view.cursor], [locale.t('owner'), chosen?.ownerMemberId ?? member?.memberId], [locale.t('model'), member?.model ?? member?.provider], [locale.t('state'), chosen?.state], [locale.t('dependencies'), task ? (view.plan?.dependencies ?? []).filter(item => item.taskId === task.taskId).map(item => item.blockedByTaskId).join(', ') || '—' : undefined], [locale.t('quality'), task?.quality?.verdict ?? attempt?.quality?.verdict]];
      const actions = [];
      if (!view.planConfirmed && view.planDigest) actions.push(['plan.confirm', { planDigest: view.planDigest }, locale.t('confirmPlan')]);
      if (attempt?.state === 'running') actions.push(['attempt.pause', { taskId: attempt.taskId, attemptId: attempt.attemptId }, locale.t('pause')]);
      if (attempt?.state === 'paused') actions.push(['attempt.resume', { taskId: attempt.taskId, attemptId: attempt.attemptId }, locale.t('resume')]);
      if (attempt && ['running', 'paused', 'taken-over'].includes(attempt.state)) actions.push(['attempt.terminate', { taskId: attempt.taskId, attemptId: attempt.attemptId }, locale.t('terminate')]);
      if (['planned', 'completed'].includes(view.lifecycle)) actions.push(['team.archive', {}, locale.t('archive')]);
      if (view.lifecycle === 'archived') actions.push(['team.restore', {}, locale.t('restore')]);
      return h('aside', { className: 'ant-inspector', 'aria-label': locale.t('inspector') }, h('h2', { className: 'ant-section-title' }, locale.t('inspector')), h('dl', { className: 'ant-facts' }, rows.map(([label, value]) => h('div', { className: 'ant-fact', key: label }, h('dt', null, label), h('dd', null, value ?? locale.t('unknown'))))), h('p', { className: 'ant-note' }, chosen?.title ?? attempt?.attemptId ?? member?.role ?? locale.t('noSelection')), actions.length ? h('div', { className: 'ant-actions' }, actions.map(([action, payload, label]) => h('button', { key: action, type: 'button', className: 'ant-button', disabled: Boolean(state.request), onClick: () => dispatch(action, payload) }, label))) : null);
    }

    function MainPanel({ model, locale }) {
      const state = useModel(model);
      const t = useLocale(locale);
      React.useEffect(() => { model.loadList(); }, [model]);
      const loading = state.status === 'loading' && !state.view && !state.teams.length;
      return h('main', { className: 'ant-shell', 'aria-labelledby': 'ant-title' }, h(StyleSheet), h('header', { className: 'ant-header' }, h('div', null, h('h1', { className: 'ant-title', id: 'ant-title' }, t.t('title')), h('p', { className: 'ant-subtitle' }, t.t('subtitle'))), h('label', { className: 'ant-select-label' }, t.t('team'), h('select', { className: 'ant-select', value: state.selectedTeamId ?? '', onChange: event => model.selectTeam(event.target.value), disabled: !state.teams.length }, [h('option', { value: '', key: 'empty' }, t.t('team')), ...state.teams.map(team => h('option', { value: team.teamId, key: team.teamId }, team.goal ?? team.teamId))])), h('div', { className: 'ant-meta' }, h('span', null, t.t('lifecycle')), h('strong', null, state.view?.lifecycle ?? t.t('unknown'))), h('div', { className: 'ant-meta' }, h('span', null, t.t('cursor')), h('strong', null, state.view?.cursor ?? '—')), h('button', { type: 'button', className: 'ant-button', onClick: model.loadList, disabled: Boolean(state.request), 'aria-label': t.t('refresh') }, t.t('refresh'))), statusText(state, t), loading ? h('div', { className: 'ant-loading', role: 'status', 'aria-busy': 'true' }, t.t('loading')) : state.status === 'empty' ? h('div', { className: 'ant-empty', role: 'status' }, h('div', null, h('strong', null, t.t('empty')), h('span', null, t.t('emptyHint')))) : h('div', { className: 'ant-body' }, h(Index, { state, locale: t, onSelect: model.selectTeam }), h('section', { className: 'ant-orbit', 'aria-label': t.t('compass') }, h('div', { className: 'ant-orbit-header' }, h('h2', { className: 'ant-section-title' }, t.t('compass')), h('div', { className: 'ant-counts' }, h('span', { className: 'ant-chip' }, `${t.t('members')} ${state.view?.members?.length ?? 0}`), h('span', { className: 'ant-chip' }, `${t.t('attempts')} ${state.view?.attempts?.length ?? 0}`), h('span', { className: 'ant-chip' }, `${t.t('tasks')} ${state.view?.tasks?.length ?? 0}`))), h(Orbit, { state, locale: t, onSelect: model.selectNode })), h(Inspector, { state, locale: t, dispatch: model.dispatch })));
    }

    function Sidebar({ locale }) { const t = useLocale(locale); return h('span', { title: t.t('panel'), 'aria-label': t.t('panel'), role: 'img', 'data-ant-icon': '' }, h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('circle', { cx: 8, cy: 4, r: 1.5 }), h('circle', { cx: 8, cy: 8, r: 1.2 }), h('ellipse', { cx: 8, cy: 12, rx: 1.7, ry: 2.2 }), h('path', { d: 'M7 3 6 1.6' }), h('path', { d: 'M9 3 10 1.6' }), h('path', { d: 'M6.9 7.4 4 6' }), h('path', { d: 'M6.9 8.2 3.6 8.8' }), h('path', { d: 'M6.9 9 4.2 11' }), h('path', { d: 'M9.1 7.4 12 6' }), h('path', { d: 'M9.1 8.2 12.4 8.8' }), h('path', { d: 'M9.1 9 11.8 11' }))); }
    function StyleSheet() { return h('style', { 'data-ant': 'styles' }, CSS); }

    async function apply(ctx) {
      const remoteDisposer = await ctx.remote.$mount(TEAM_REMOTE);
      let follow;
      try {
        follow = ctx.inject(['remote.team'], remoteCtx => {
          const locale = createLocale(remoteCtx);
          const model = createController(remoteCtx.remote.team);
          remoteCtx.effect(() => remoteCtx.locale.register(LOCALE_NS, DICT), 'ant: locale');
          remoteCtx.effect(() => locale.dispose, 'ant: locale subscription');
          remoteCtx.effect(() => model.dispose, 'ant: model');
          const mainDisposer = remoteCtx.slots.inject('main', () => remoteCtx.slots.register({ name: 'main', key: PANEL_ID, locale: LOCALE_NS, inject: () => ({ model, locale }) }, MainPanel));
          remoteCtx.effect(() => mainDisposer, 'ant: main slot');
          const sidebarDisposer = remoteCtx.slots.inject('sidebar.panellist', () => remoteCtx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 25, locale: LOCALE_NS, label: () => locale.t('panel'), inject: () => ({ locale }) }, Sidebar));
          remoteCtx.effect(() => sidebarDisposer, 'ant: sidebar slot');
        });
      } catch (error) {
        await remoteDisposer();
        throw error;
      }
      return async () => {
        await follow.dispose();
        await remoteDisposer();
      };
    }

    return { inject: ['remote', 'slots', 'locale'], apply };
  },
});
