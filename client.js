window.__ModuleLoader__.load({
  id: '@zhuifengqug/dsh-ant',
  factory(require) {
    const React = require('react');
    const zodModule = require('zod');
    const z = zodModule.z ?? zodModule;
    const h = React.createElement;
    /** Set window.__ANT_DEBUG__ = true to see how far the client gets. */
    const DEBUG = typeof window !== 'undefined' && window.__ANT_DEBUG__ === true;
    function trace(stage, detail) {
      if (!DEBUG) return;
      try { console.debug('[ant]', stage, detail === undefined ? '' : String(detail.stack ?? detail).slice(0, 700)); } catch { /* tracing never breaks the panel */ }
    }
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
    trace('remote-built');

    const DICT = {
      en: {
        panel: 'Ant', title: 'Amber Ant', subtitle: 'Durable multi-session collaboration', refresh: 'Refresh',
        loading: 'Loading team facts', refreshing: 'Refreshing', empty: 'No teams in this workspace',
        emptyHint: 'Create a team from the Host action surface, then refresh this panel.', team: 'Team', lifecycle: 'Lifecycle', cursor: 'Fact cursor',
        members: 'Members', attempts: 'Attempts', tasks: 'Tasks', inspector: 'Inspection desk',
        noSelection: 'Select a task or attempt to inspect it.', unknown: 'Unknown', owner: 'Owner', model: 'Model', state: 'State',
        dependencies: 'Dependencies', quality: 'Quality gates', confirmPlan: 'Confirm plan', pause: 'Pause attempt', resume: 'Resume attempt',
        terminate: 'Terminate attempt', archive: 'Archive team', restore: 'Restore team', dispatching: 'Dispatching', committed: 'Committed',
        duplicate: 'Duplicate', error: 'Action failed', stale: 'Facts moved forward; refresh before retrying.', unavailable: 'Host is unavailable. Last known facts remain visible.',
        notFound: 'Team was not found. Refresh the list.', rebuild: 'The read model needs rebuilding. Refresh the facts.', lease: 'The writer lease is unavailable.',
        persistence: 'The receipt was not persisted.', nest: 'Colony section', nursery: 'Nursery', gate: 'Gate hall', corridor: 'Main passage',
        pantry: 'Store', refuse: 'Refuse heap', ants: 'Ants', queen: 'Queen', gateOpen: 'Gate', pendingBatch: 'pending release',
        releaseNow: 'Release batch', stageHint: 'Press 1-5 for a chamber, Tab to the gate, Enter to release.',
        stream: 'Activity', streamRunning: 'Running', streamIdle: 'Idle', streamHelp: 'Needs attention', noActivity: 'Nothing is running right now.',
        autonomy: 'Autonomy', batchWindow: 'Batch window (minutes)', maxActive: 'Concurrent attempts', defaultVariants: 'Candidates per task',
        variantWrite: 'Allow parallel candidates on write tasks', settings: 'Amber Ant settings', save: 'Save settings', saved: 'Saved. The next action already uses it.',
        confirmL3: 'L3 releases batches by itself once the window closes. Switch anyway?', confirm: 'Switch to L3', cancel: 'Cancel',
        settingsHint: 'The panel and the Host share one settings file.', pendingBadge: 'pending release', openNest: 'Open colony', unread: 'unread', takeover: 'Take over',
      },
      zh: {
        panel: '玄驹', title: '虫珀·玄驹', subtitle: '多会话协作持久事实面', refresh: '刷新', loading: '正在读取团队事实', refreshing: '正在刷新',
        empty: '当前工作区暂无团队', emptyHint: '请先从 Host 动作入口创建团队，再刷新此面板。', team: '团队', lifecycle: '生命周期', cursor: '事实游标',
        members: '成员', attempts: 'Attempt', tasks: '任务', inspector: '任务检查台', noSelection: '选择任务或 Attempt 查看事实。',
        unknown: '未知', owner: '负责人', model: '模型', state: '状态', dependencies: '依赖', quality: '质量门', confirmPlan: '确认计划',
        pause: '暂停 Attempt', resume: '恢复 Attempt', terminate: '终止 Attempt', archive: '归档团队', restore: '恢复团队', dispatching: '正在派发',
        committed: '已提交', duplicate: '重复请求', error: '动作失败', stale: '事实已前进，请刷新后重试。', unavailable: 'Host 暂不可用，仍保留最后已知事实。',
        persistence: '回执未持久化。', nest: '蚁巢剖面', nursery: '孵化室', gate: '闸门厅', corridor: '主通道', pantry: '储藏室', refuse: '废料堆',
        ants: '蚂蚁', queen: '蚁后', gateOpen: '巢门', pendingBatch: '待放行', releaseNow: '放行本批', stageHint: '按 1–5 切换巢室，Tab 到巢门，Enter 放行。',
        stream: '活动流', streamRunning: '进行中', streamIdle: '空闲', streamHelp: '需干预', noActivity: '当前没有进行中的活动。',
        autonomy: '自主级别', batchWindow: '批窗口（分钟）', maxActive: '并发上限', defaultVariants: '每任务候选数',
        variantWrite: '允许写任务并行候选', settings: '玄驹设置', save: '保存设置', saved: '已保存，下一次动作即生效。',
        confirmL3: 'L3 会在窗口到期后自动放行，仍要切换吗？', confirm: '切到 L3', cancel: '取消',
        settingsHint: '面板与 Host 共用同一份设置文件。', pendingBadge: '待放行', openNest: '进入蚁巢', unread: '未读', takeover: '接管',
       
      },
    };


    Object.assign(DICT.en, {
      releaseTask: 'Release task', claim: 'Claim task', gates: 'Quality gates', evidence: 'Evidence',
      gatePass: 'passed', gateRunning: 'running', gateOpenState: 'open',
      requirement: 'Requirement', implementation: 'Implementation', verification: 'Verification', review: 'Review', integration: 'Integration',
    });
    Object.assign(DICT.zh, {
      releaseTask: '放行任务', claim: '认领任务', gates: '五道门', evidence: '证据',
      gatePass: '通过', gateRunning: '在跑', gateOpenState: '未开始',
      requirement: '需求', implementation: '实现', verification: '验证', review: '审查', integration: '集成',
    });


    Object.assign(DICT.en, {
      close: 'Close', idle: 'idle',
      stateQueued: 'queued', stateRunning: 'running', statePaused: 'paused', stateTakenOver: 'taken over',
      statePending: 'waiting', stateReviewed: 'ready to release', stateReleased: 'released', stateCompleted: 'done',
      stateFailed: 'failed', stateAnomalous: 'anomalous', stateTerminated: 'stopped',
    });
    Object.assign(DICT.zh, {
      close: '关闭', idle: '空闲',
      stateQueued: '排队', stateRunning: '进行中', statePaused: '已暂停', stateTakenOver: '已接管',
      statePending: '等待', stateReviewed: '待放行', stateReleased: '已放行', stateCompleted: '已完成',
      stateFailed: '失败', stateAnomalous: '异常', stateTerminated: '已终止',
    });

const CSS = `
      .ant-seat{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 9px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;transition:border-color .12s ease,background-color .12s ease,color .12s ease}
      .ant-seat:hover{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}
      .ant-seat[aria-expanded=true]{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}
      .ant-seat:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
      .ant-ant{flex:none;color:currentColor;opacity:.86}
      .ant-seat[data-busy=true] .ant-ant{color:var(--dsw-alias-state-business-primary);opacity:1}
      .ant-seat-count{flex:none;min-width:15px;height:15px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted);font-size:9.5px;font-weight:600;line-height:15px;text-align:center;font-variant-numeric:tabular-nums}
      .ant-panel{position:absolute;top:var(--dsh-frame-overlay-top,74px);right:16px;display:flex;flex-direction:column;width:380px;max-height:calc(100% - var(--dsh-frame-overlay-top,74px) - 132px);max-width:calc(100% - 32px);box-sizing:border-box;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;box-shadow:0 18px 44px color-mix(in srgb,var(--dsw-alias-bg-mask-3) 24%,transparent),0 2px 8px color-mix(in srgb,var(--dsw-alias-bg-mask-3) 12%,transparent);animation:ant-panel-in .14s ease-out}
      .ant-panel *{box-sizing:border-box}
      @keyframes ant-panel-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
      .ant-panel-head{display:flex;flex:none;align-items:center;gap:8px;padding:9px 8px 9px 13px;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .ant-panel-head .ant-ant{color:var(--dsw-alias-label-primary)}
      .ant-panel-name{flex:none;font-size:13px;font-weight:600;line-height:18px}
      .ant-panel-goal{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
      .ant-icon{display:grid;flex:none;width:24px;height:24px;place-items:center;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:15px;line-height:1;cursor:pointer;transition:background-color .12s ease,color .12s ease}
      .ant-icon:hover{background:var(--dsw-alias-button-ghost-active-fill);color:var(--dsw-alias-label-primary)}
      .ant-icon:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
      .ant-panel-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px 0 8px;scrollbar-width:thin}
      .ant-panel-section{display:flex;align-items:center;gap:6px;padding:7px 13px 3px;color:var(--dsw-alias-label-tertiary);font-size:10.5px;font-weight:600;letter-spacing:.04em}
      .ant-panel-section span{margin-left:auto;font-weight:400;font-variant-numeric:tabular-nums}
      .ant-row{display:flex;align-items:center;gap:8px;min-height:30px;padding:4px 13px;color:inherit;font:inherit}
      .ant-row[data-state=running] .ant-ant{color:var(--dsw-alias-state-business-primary);opacity:1}
      .ant-row-name{flex:1;min-width:0;overflow:hidden;font-size:12px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
      .ant-row-note{flex:none;max-width:126px;overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}
      .ant-chip{flex:none;max-width:120px;overflow:hidden;padding:2px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:10.5px;line-height:14px;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;transition:border-color .12s ease,color .12s ease}
      .ant-chip:hover,.ant-chip[aria-expanded=true]{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
      .ant-chip:focus-visible,.ant-primary:focus-visible,.ant-model-pick:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
      .ant-models{margin:2px 13px 8px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 10px 24px color-mix(in srgb,var(--dsw-alias-bg-mask-3) 18%,transparent);max-height:196px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
      .ant-models p{margin:2px 6px;color:var(--dsw-alias-label-tertiary);font-size:11px}
      .ant-model-pick{display:flex;width:100%;align-items:center;gap:8px;height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;text-align:left;cursor:pointer}
      .ant-model-pick:hover{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}
      .ant-model-pick[aria-pressed=true]{color:var(--dsw-alias-label-primary)}
      .ant-model-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ant-model-provider{flex:none;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Consolas,monospace;font-size:10px}
      .ant-model-check{flex:none;width:12px;color:var(--dsw-alias-state-business-primary);font-size:11px}
      .ant-panel-foot{display:flex;flex:none;align-items:center;gap:8px;padding:8px 13px;border-top:1px solid var(--dsw-alias-border-l2)}
      .ant-primary{flex:1;min-height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;transition:border-color .12s ease,color .12s ease}
      .ant-primary:hover:not([disabled]){border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
      .ant-primary[disabled]{cursor:default;opacity:.45}
      .ant-panel-status{padding:8px 13px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
      .ant-panel-empty{display:flex;flex-direction:column;gap:4px;padding:18px 13px;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:17px}
      .ant-panel-empty strong{color:var(--dsw-alias-label-primary);font-size:12.5px}
      @media (prefers-reduced-motion: reduce){.ant-panel{animation:none}}
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

    function unwrapRemoteResult(result) {
      if (result?.ok === true) return result.value;
      if (result?.ok === false) throw result.error;
      throw new Error('Client Remote returned an invalid result envelope');
    }

    function createController(remote) {
      let state = { status: 'loading', teams: [], selectedTeamId: undefined, view: undefined, selectedTaskId: undefined, selectedAttemptId: undefined, selectedMemberId: undefined, selectedStage: undefined, request: undefined, receipt: undefined, error: undefined };
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
      let bootstrapped = false;
      const loadList = async () => {
        if (!disposed) bootstrapped = true;
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
      const selectTeam = teamId => { emit({ selectedTeamId: teamId, selectedTaskId: undefined, selectedAttemptId: undefined, selectedMemberId: undefined, selectedStage: undefined }); return loadView(teamId); };
      const selectStage = stage => { if (state.selectedStage !== stage) emit({ selectedStage: stage }); };
      const selectNode = (layer, id) => emit({ selectedTaskId: layer === 'task' ? id : state.selectedTaskId, selectedAttemptId: layer === 'attempt' ? id : state.selectedAttemptId, selectedMemberId: layer === 'member' ? id : state.selectedMemberId });
      const dispatch = async (action, payload) => {
        if (!state.selectedTeamId || state.request || disposed) return;
        const request = { requestId: makeRequestId(), teamId: state.selectedTeamId, action, payload };
        emit({ request, receipt: undefined, error: undefined });
        try { const receipt = unwrapRemoteResult(await remote.dispatch(request, nextSignal())); if (disposed) return; emit({ request: undefined, receipt }); await loadView(request.teamId, receipt?.lastEventSeq); }
        catch (error) { if (!disposed) { const normalized = normalizeError(error); emit({ request: undefined, status: statusForError(normalized), error: normalized }); } }
      };
      return { subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, getSnapshot: () => state, loadList, ensureLoaded() { if (disposed || bootstrapped) return undefined; return loadList(); }, selectTeam, selectNode, selectStage, dispatch, dispose() { disposed = true; sequence += 1; controller?.abort(); listeners.clear(); } };
    }

    function useModel(model) { return React.useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot); }
    function useLocale(locale) { React.useSyncExternalStore(locale.subscribe, locale.snapshot, locale.snapshot); return locale; }
    function useShell(shell) { return React.useSyncExternalStore(shell.subscribe, shell.getSnapshot, shell.getSnapshot); }

    const ACTIVE_ATTEMPT = ['queued', 'running', 'paused', 'taken-over'];
    const STATE_KEYS = {
      queued: 'stateQueued', running: 'stateRunning', paused: 'statePaused', 'taken-over': 'stateTakenOver',
      pending: 'statePending', reviewed: 'stateReviewed', released: 'stateReleased', completed: 'stateCompleted',
      failed: 'stateFailed', anomalous: 'stateAnomalous', terminated: 'stateTerminated',
    };

    /** One task lives in exactly one chamber; the five chambers partition the view. */
    function pendingReleaseTasks(view) { return view?.releaseQueue ?? []; }
    /** Unread mail is the Host summary count; the panel never recomputes receipts itself. */
    function unreadMail(view) { return view?.summary?.unread?.total ?? 0; }
    function liveMembers(view) { return (view?.members ?? []).filter(member => member.status !== 'removed'); }
    function memberName(member) { return member.role ?? member.name ?? shortId(member.memberId); }
    function heldTask(member, view) {
      const attempt = (view?.attempts ?? []).find(item => item.memberId === member.memberId && ACTIVE_ATTEMPT.includes(item.state));
      return attempt === undefined ? undefined : (view?.tasks ?? []).find(task => task.taskId === attempt.taskId);
    }
    function stateWord(state, t) { return t.t(STATE_KEYS[state] ?? 'unknown'); }
    function statusLine(state, t) {
      if (!state.error) return undefined;
      const key = { 'stale-cursor': 'stale', 'not-found': 'notFound', 'rebuild-required': 'rebuild', lease: 'lease', 'persistence-failed': 'persistence' }[state.status];
      return t.t(key ?? 'unavailable');
    }

    /** One solid silhouette, currentColor, no outline — the same ant at every size. */
    function AntShape({ size = 12, className, ...rest }) {
      const width = size * 1.55;
      return h('svg', { className, viewBox: '-20 -11 38 20', width, height: size, 'aria-hidden': 'true', focusable: 'false', ...rest },
        h('ellipse', { cx: 9.9, cy: -1.1, rx: 3.2, ry: 2.9, fill: 'currentColor' }),
        h('path', { d: 'M10.9 -3.4 L12.2 -6.2 L15.4 -5.8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        h('ellipse', { cx: 4.1, cy: 0.2, rx: 3.5, ry: 2.5, fill: 'currentColor', transform: 'rotate(-8 4.1 .2)' }),
        h('ellipse', { cx: -0.5, cy: 0.5, rx: 1.15, ry: 1.05, fill: 'currentColor' }),
        h('ellipse', { cx: -7.2, cy: 1.3, rx: 6, ry: 4.2, fill: 'currentColor', transform: 'rotate(-10 -7.2 1.3)' }),
        h('path', { d: 'M6.2 0.6 L10.4 -3.2 L13.4 2.2 M3.8 0.8 L4.6 -3.4 L3.2 5.2 M1 1 L-2.4 -2.6 L-6.4 2.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' }));
    }

    /** The single entry beside the permission chip: one click opens the colony panel. */
    function ColonySeat({ model, locale, ui, catalog, sessionId }) {
      const state = useModel(model);
      const t = useLocale(locale);
      const open = useShell(ui);
      // The overlay slot has no session of its own; the seat hands it the catalogue.
      ui.setCatalog(catalog);
      React.useEffect(() => { model.ensureLoaded(); }, [model]);
      const view = state.view ?? {};
      // The colony only speaks to its own conversations: another team's session gets no seat.
      const belongs = sessionId === undefined || (view.members ?? []).some(member => member.sessionId === sessionId);
      const hidden = (state.teams ?? []).length > 0 && !belongs;
      React.useEffect(() => { if (hidden && open) ui.set(false); }, [hidden, open, ui]);
      if (hidden) return null;
      const count = pendingReleaseTasks(view).length || unreadMail(view);
      const busy = (view.attempts ?? []).some(item => ACTIVE_ATTEMPT.includes(item.state));
      return h('button', {
        type: 'button',
        className: 'ant-seat',
        'data-ant-seat': '',
        'data-busy': busy ? 'true' : undefined,
        'aria-expanded': open ? 'true' : 'false',
        'aria-haspopup': 'dialog',
        title: t.t('panel'),
        'aria-label': t.t('panel'),
        onClick: () => ui.toggle(),
      },
        h(AntShape, { size: 12, className: 'ant-ant' }),
        h('span', null, t.t('panel')),
        count ? h('span', { className: 'ant-seat-count', 'aria-hidden': 'true' }, String(count)) : null);
    }

    /** The colony lives in the shell overlay: a docked card, never a page of its own. */
    function ColonyPanel({ model, locale, ui }) {
      const state = useModel(model);
      const t = useLocale(locale);
      const open = useShell(ui);
      const [picker, setPicker] = React.useState(undefined);
      const [groups, setGroups] = React.useState(undefined);
      const [catalogFailed, setCatalogFailed] = React.useState(false);
      React.useEffect(() => { if (open) model.ensureLoaded(); }, [open, model]);
      React.useEffect(() => {
        if (open || picker === undefined) return undefined;
        setPicker(undefined);
        return undefined;
      }, [open, picker]);
      React.useEffect(() => {
        if (!open || picker === undefined || groups !== undefined) return undefined;
        let live = true;
        (async () => {
          try {
            const directory = ui.catalog();
            if (!directory) throw new Error('no model directory');
            await directory.load();
            if (live) setGroups(directory.store.getSnapshot().groups ?? []);
          } catch (error) { trace('catalog-failed', error); if (live) setCatalogFailed(true); }
        })();
        return () => { live = false; };
      }, [open, picker, groups, ui]);
      React.useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined;
        const dismiss = event => {
          const target = event.target;
          if (!target || typeof target.closest !== 'function') return;
          if (target.closest('[data-ant-panel]') || target.closest('[data-ant-seat]')) return;
          ui.set(false);
        };
        const escape = event => { if (event.key === 'Escape') ui.set(false); };
        document.addEventListener('mousedown', dismiss);
        document.addEventListener('keydown', escape);
        return () => {
          document.removeEventListener('mousedown', dismiss);
          document.removeEventListener('keydown', escape);
        };
      }, [open, ui]);
      if (!open) return null;
      const view = state.view ?? {};
      const members = liveMembers(view);
      const tasks = view.tasks ?? [];
      const busyIds = new Set((view.attempts ?? []).filter(item => ACTIVE_ATTEMPT.includes(item.state)).map(item => item.memberId));
      const pending = pendingReleaseTasks(view);
      const unread = unreadMail(view);
      const notice = statusLine(state, t);
      const choose = (member, group, item) => {
        setPicker(undefined);
        model.dispatch('member.changeModel', { memberId: member.memberId, provider: group.id, model: item.id });
      };
      const release = () => model.dispatch('batch.release', {
        batchId: 'batch-' + ((view.cursor ?? 0) + 1),
        taskIds: pending.map(task => task.taskId),
      });
      const modelList = member => {
        if (catalogFailed) return h('p', null, t.t('unavailable'));
        if (groups === undefined) return h('p', null, t.t('loading'));
        const rows = groups.flatMap(group => (group.models ?? []).map(item => ({ group, item })));
        if (rows.length === 0) return h('p', null, t.t('empty'));
        return rows.map(({ group, item }) => {
          const active = item.id === member.model && group.id === member.provider;
          return h('button', {
            key: group.id + ':' + item.id,
            type: 'button',
            className: 'ant-model-pick',
            'data-model': item.id,
            'data-provider': group.id,
            'aria-pressed': active ? 'true' : 'false',
            onClick: () => choose(member, group, item),
          },
            h('span', { className: 'ant-model-name' }, item.label ?? item.id),
            h('span', { className: 'ant-model-provider' }, group.id),
            h('span', { className: 'ant-model-check', 'aria-hidden': 'true' }, active ? '✓' : ''));
        });
      };
      const memberBlock = member => h('div', { key: member.memberId, className: 'ant-member' },
        h('div', { className: 'ant-row', 'data-state': busyIds.has(member.memberId) ? 'running' : 'idle' },
          h(AntShape, { size: 11, className: 'ant-ant' }),
          h('span', { className: 'ant-row-name' }, memberName(member)),
          h('span', { className: 'ant-row-note' }, heldTask(member, view)?.title ?? (member.status === 'active' ? t.t('idle') : String(member.status ?? ''))),
          h('button', {
            type: 'button',
            className: 'ant-chip',
            'data-member': member.memberId,
            title: t.t('model'),
            'aria-expanded': picker === member.memberId ? 'true' : 'false',
            onClick: () => setPicker(picker === member.memberId ? undefined : member.memberId),
          }, (member.model ?? member.provider ?? '—') + ' ▾')),
        picker === member.memberId ? h('div', { className: 'ant-models' }, modelList(member)) : null);
      const order = { running: 0, paused: 1, 'taken-over': 1, reviewed: 2, failed: 3, anomalous: 3, pending: 4, queued: 5, terminated: 6, released: 7, completed: 7 };
      const taskRow = task => h('div', { key: task.taskId, className: 'ant-row', 'data-state': task.state },
        h('span', { className: 'ant-row-name' }, task.title ?? task.taskId),
        h('span', { className: 'ant-row-note' }, stateWord(task.state, t)));
      const body = state.status === 'loading' && !state.view
        ? h('p', { className: 'ant-panel-status', role: 'status' }, t.t('loading'))
        : state.status === 'empty'
          ? h('div', { className: 'ant-panel-empty' }, h('strong', null, t.t('empty')), h('span', null, t.t('emptyHint')))
          : [
            h('div', { key: 'members-head', className: 'ant-panel-section' }, t.t('members'), h('span', null, String(members.length))),
            members.length ? members.map(memberBlock) : h('p', { key: 'no-members', className: 'ant-panel-status' }, t.t('empty')),
            h('div', { key: 'tasks-head', className: 'ant-panel-section' }, t.t('tasks'), h('span', null, String(tasks.length))),
            tasks.length ? [...tasks].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9)).map(taskRow) : h('p', { key: 'no-tasks', className: 'ant-panel-status' }, t.t('noActivity')),
          ];
      return h('div', { className: 'ant-panel', 'data-ant-panel': '', role: 'dialog', 'aria-label': t.t('panel') },
        h('div', { className: 'ant-panel-head' },
          h(AntShape, { size: 13, className: 'ant-ant' }),
          h('strong', { className: 'ant-panel-name' }, t.t('panel')),
          h('span', { className: 'ant-panel-goal' }, view.goal ?? ''),
          h('button', { type: 'button', className: 'ant-icon', title: t.t('close'), 'aria-label': t.t('close'), onClick: () => ui.set(false) }, '×')),
        notice ? h('p', { className: 'ant-panel-status', role: 'alert' }, notice) : null,
        h('div', { className: 'ant-panel-body' }, body),
        h('div', { className: 'ant-panel-foot' },
          h('button', { type: 'button', className: 'ant-primary', disabled: Boolean(state.request) || !pending.length, onClick: release }, t.t('releaseNow') + (pending.length ? ' ' + pending.length : '')),
          unread ? h('span', { className: 'ant-row-note' }, unread + ' ' + t.t('unread')) : null));
    }

    /** The stylesheet is global: the seat and the panel are registered on different slots. */
    function installStyles() {
      if (typeof document === 'undefined' || !document.head) return () => {};
      const existing = document.querySelector('style[data-ant="styles"]');
      if (existing) return () => {};
      const element = document.createElement('style');
      element.setAttribute('data-ant', 'styles');
      element.textContent = CSS;
      document.head.appendChild(element);
      return () => { element.remove(); };
    }

    /** Resolve the Host model catalogue for this Session without hard-depending on it. */
    function directoryOf(ctx, sessionId) {
      try {
        const directories = typeof ctx.get === 'function' ? ctx.get('modelDirectories') : undefined;
        if (!directories || sessionId === undefined) return undefined;
        return directories.directoryFor(sessionId);
      } catch (error) { trace('catalog-failed', error); return undefined; }
    }

    /** Panel visibility is shared state: the seat lives in the composer, the panel in the overlay. */
    function createShell() {
      let open = false;
      let resolveCatalog;
      const listeners = new Set();
      return {
        getSnapshot: () => open,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        set(value) { if (open !== value) { open = value; listeners.forEach(listener => listener()); } },
        toggle() { this.set(!open); },
        setCatalog(fn) { resolveCatalog = fn; },
        catalog() { return typeof resolveCatalog === 'function' ? resolveCatalog() : undefined; },
        dispose() { listeners.clear(); resolveCatalog = undefined; },
      };
    }

    function registerSurfaces(ctx, model, locale, shell) {
      const disposers = [];
      const bind = (slot, options, component) => {
        try {
          disposers.push(ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, locale: LOCALE_NS, ...options, inject: options.inject ?? (() => ({ model, locale, ui: shell })) }, component)));
          trace('bind:' + slot);
        } catch (error) {
          trace('bind-failed:' + slot, error);
        }
      };
      bind('shell.overlay', { id: PANEL_ID, order: 80, label: 'Ant colony' }, ColonyPanel);
      bind('conversation.input.left', {
        id: PANEL_ID, order: 10,
        inject: sessionId => ({ model, locale, ui: shell, sessionId, catalog: () => directoryOf(ctx, sessionId) }),
      }, ColonySeat);
      return disposers;
    }

    async function apply(ctx) {
      trace('apply-enter', Object.keys(ctx.remote ?? {}).join(','));
      let remoteDisposer;
      try {
        remoteDisposer = await ctx.remote.$mount(TEAM_REMOTE);
      } catch (error) {
        trace('mount-failed', error);
        throw error;
      }
      trace('mounted');
      let follow;
      try {
        follow = ctx.inject(['remote.team'], remoteCtx => {
          trace('inject-fired');
          let locale;
          let model;
          let shell;
          try {
            locale = createLocale(remoteCtx);
            model = createController(remoteCtx.remote.team);
            shell = createShell();
            trace('model-created');
            remoteCtx.effect(() => remoteCtx.locale.register(LOCALE_NS, DICT), 'ant: locale');
            remoteCtx.effect(() => locale.dispose, 'ant: locale subscription');
            remoteCtx.effect(() => model.dispose, 'ant: model');
            remoteCtx.effect(() => shell.dispose, 'ant: shell');
            remoteCtx.effect(() => installStyles(), 'ant: styles');
            for (const dispose of registerSurfaces(remoteCtx, model, locale, shell)) remoteCtx.effect(() => dispose, 'ant: surface');
            trace('surfaces-registered');
            if (DEBUG) setTimeout(() => {
              try {
                const count = selector => document.querySelectorAll(selector).length;
                trace('dom-probe', JSON.stringify({ seat: count('[data-ant-seat]'), panel: count('[data-ant-panel]') }));
              } catch (error) { trace('dom-probe-failed', error); }
            }, 2500);
          } catch (error) {
            trace('inject-body-failed', error);
            throw error;
          }
        });
      } catch (error) {
        trace('inject-failed', error);
        await remoteDisposer();
        throw error;
      }
      trace('follow-created');
      return async () => {
        await follow.dispose();
        await remoteDisposer();
      };
    }

    return { inject: ['remote', 'slots', 'locale'], apply };

  },
});
