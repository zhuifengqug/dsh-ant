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

const CSS = `
      .ant-shell{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:inherit;}
      @supports (color:light-dark(#000,#fff)){.ant-shell,.ant-seat{--ant-neon:light-dark(#008fa9,#16d9ed);--ant-neon-2:light-dark(#b0249f,#f04bd7);--ant-ok:light-dark(#0b8a63,#46d9aa);--ant-bad:light-dark(#c33b4f,#ff6179);--ant-grid:light-dark(rgba(40,70,95,.13),rgba(127,160,190,.16));--ant-cell:light-dark(rgba(255,255,255,.94),rgba(9,17,29,.86));--ant-row-hover:light-dark(rgba(0,143,169,.09),rgba(22,217,237,.09))}}
      .ant-shell,.ant-seat{--ant-neon:#16d9ed;--ant-neon-2:#f04bd7;--ant-ok:#46d9aa;--ant-bad:#ff6179;--ant-grid:rgba(127,160,190,.16);--ant-cell:rgba(9,17,29,.86);--ant-row-hover:rgba(22,217,237,.09);--ant-mono:"Cascadia Mono",Consolas,ui-monospace,monospace}
      .ant-shell *,.ant-seat *{box-sizing:border-box}
      .ant-header{display:grid;grid-template-columns:minmax(180px,1fr) auto auto auto auto;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .ant-title{margin:0;font-size:17px;line-height:1.25;font-weight:700;letter-spacing:.02em}
      .ant-subtitle{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:11px}
      .ant-meta{display:flex;flex-direction:column;gap:3px;color:var(--dsw-alias-label-secondary);font-size:10.5px;letter-spacing:.06em}
      .ant-meta strong{color:var(--dsw-alias-label-primary);font-size:12px;letter-spacing:0;font-variant-numeric:tabular-nums}
      .ant-select,.ant-button{min-height:32px;border:1px solid var(--dsw-alias-border-l1);border-radius:2px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
      .ant-select{min-width:168px;padding:0 10px}.ant-button{padding:0 12px;cursor:pointer}
      .ant-button:hover{border-color:var(--ant-neon);color:var(--ant-neon)}
      .ant-button:focus-visible,.ant-select:focus-visible,.ant-chamber-head:focus-visible,.ant-gate:focus-visible,.ant-row:focus-visible{outline:2px solid var(--ant-neon);outline-offset:2px}
      .ant-button[disabled]{cursor:wait;opacity:.5}
      .ant-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,282px);min-height:0;flex:1}
      .ant-nest{position:relative;min-width:0;min-height:0;overflow:hidden;padding:0;background:var(--dsw-alias-bg-base)}
      .ant-nest::before{content:'';position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(var(--ant-grid) 1px,transparent 1px),linear-gradient(90deg,var(--ant-grid) 1px,transparent 1px);background-size:34px 34px;opacity:.5}
      .ant-nest-plan{position:absolute;inset:0}
      .ant-blueprint{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
      .ant-tunnels{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
      .ant-tunnel{fill:none;stroke:var(--ant-neon-2);stroke-width:1.2;stroke-dasharray:3 5;opacity:.55}
      .ant-conduit{fill:none;stroke:var(--dsw-alias-border-l2);stroke-width:9;opacity:.5;stroke-linejoin:round}
      .ant-conduit-core{fill:none;stroke:var(--ant-neon);stroke-width:1.6;opacity:.8;stroke-dasharray:2 10;animation:ant-flow 2.6s linear infinite}
      .ant-circuit{fill:none;stroke:var(--dsw-alias-border-l1);stroke-width:1;opacity:.55}
      .ant-node{fill:var(--dsw-alias-bg-base);stroke:var(--ant-neon);stroke-width:1.2}
      .ant-chamber{position:absolute;display:flex;flex-direction:column;gap:5px;min-width:0;padding:9px 11px;background:var(--ant-cell);clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px))}
      .ant-chamber[data-stage=nursery]{border:1px solid var(--dsw-alias-border-l1);border-left:2px solid var(--ant-neon)}
      .ant-chamber[data-stage=gate]{border:1px solid var(--ant-neon-2);border-left:2px solid var(--ant-neon-2)}
      .ant-chamber[data-stage=corridor]{border:1px solid var(--dsw-alias-border-l2);border-left:2px solid var(--ant-neon)}
      .ant-chamber[data-stage=pantry]{border:1px solid var(--dsw-alias-border-l1);border-left:2px solid var(--ant-ok)}
      .ant-chamber[data-stage=refuse]{border:1px dashed var(--dsw-alias-border-l2);border-left:2px solid var(--ant-bad)}
      .ant-chamber[aria-pressed=true]{box-shadow:inset 0 0 0 1px var(--ant-neon)}
      .ant-chamber{transition:opacity .18s ease}
      .ant-nest-plan[data-focus] .ant-chamber:not([aria-pressed=true]){opacity:.3}
      .ant-chamber-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;width:100%;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
      .ant-chamber-name{font-size:12px;font-weight:650;letter-spacing:.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .ant-chamber-count{color:var(--ant-neon);font-size:11px;font-variant-numeric:tabular-nums;letter-spacing:.08em}
      .ant-ants{display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-height:10px}
      .ant-ant{display:block;flex:none;width:auto;height:auto;color:var(--dsw-alias-label-secondary)}
      button.ant-ant{display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:2px;background:transparent;line-height:0;cursor:pointer}
      button.ant-ant:hover,button.ant-ant:focus-visible{outline:1px solid var(--ant-neon);outline-offset:1px;color:var(--ant-neon)}
      .ant-ant[data-state=active]{color:var(--ant-neon)}
      .ant-more{color:var(--dsw-alias-label-secondary);font-size:10px}
      .ant-rows{display:grid;gap:2px;min-height:0;overflow:hidden}
      .ant-row{display:flex;align-items:center;gap:7px;width:100%;padding:2px 4px;border:0;border-radius:2px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;text-align:left;cursor:pointer}
      .ant-row:hover,.ant-row[aria-current=true]{background:var(--ant-row-hover);color:var(--ant-neon)}
      .ant-row::before{content:'';flex:none;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-border-l2)}
      .ant-row[data-state=reviewed]::before{background:var(--ant-neon-2);box-shadow:0 0 6px var(--ant-neon-2)}
      .ant-row[data-state=running]::before{background:var(--ant-neon);box-shadow:0 0 6px var(--ant-neon)}
      .ant-row[data-state=pending]::before{background:transparent;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
      .ant-row[data-state=released]::before{background:var(--ant-ok)}
      .ant-row[data-state=failed]::before{background:var(--ant-bad)}
      .ant-gate{display:flex;align-items:center;justify-content:space-between;gap:10px;align-self:flex-end;margin-top:auto;min-height:28px;min-width:136px;padding:0 11px;border:1px solid var(--ant-neon-2);border-radius:2px;background:var(--ant-neon-2);color:#04121a;font:inherit;font-size:11px;font-weight:650;cursor:pointer}
      .ant-gate[disabled]{cursor:default;opacity:.45}
      .ant-rail{min-width:0;overflow:auto;padding:20px 18px;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
      .ant-rail h2{margin:0 0 4px;font-size:17px;line-height:1.25;font-weight:650;letter-spacing:.01em}
      .ant-rail-state{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:11.5px}
      .ant-rail-state i{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-border-l2)}
      .ant-rail-state i[data-state=reviewed]{background:var(--ant-neon-2)}.ant-rail-state i[data-state=running]{background:var(--ant-neon)}
      .ant-rail-state i[data-state=released]{background:var(--ant-ok)}.ant-rail-state i[data-state=failed]{background:var(--ant-bad)}
      .ant-cmd{margin:10px 0 0;padding:8px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:2px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:10.5px/1.6 var(--ant-mono);overflow-wrap:anywhere}
      .ant-actions{display:grid;gap:6px;margin:12px 0 0}
      .ant-actions .ant-button{justify-content:flex-start;text-align:left}
      .ant-rail-rule{height:1px;margin:14px 0;background:linear-gradient(90deg,var(--ant-neon),var(--dsw-alias-border-l1) 40%,transparent)}
      .ant-cap{margin:0 0 6px;color:var(--dsw-alias-label-secondary);font-size:10.5px;letter-spacing:.1em}
      .ant-gates{display:grid;gap:4px;margin:0;padding:0;list-style:none}
      .ant-gates li{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .ant-gates b{min-width:30px;font-weight:650;color:var(--dsw-alias-label-primary)}
      .ant-gates i{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-border-l2)}
      .ant-gates i[data-state=pass]{background:var(--ant-ok)}.ant-gates i[data-state=run]{background:var(--ant-neon)}.ant-gates i[data-state=open]{background:transparent;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
      .ant-facts{display:grid;gap:7px;margin:12px 0 0}.ant-fact{display:grid;grid-template-columns:minmax(72px,auto) 1fr;gap:8px;padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11.5px}
      .ant-fact dt{color:var(--dsw-alias-label-secondary)}.ant-fact dd{margin:0;overflow-wrap:anywhere}
      .ant-status{margin:0;padding:8px 16px;border-left:2px solid var(--dsw-alias-state-idle-primary);background:var(--dsw-alias-bg-layer-2);font-size:11.5px}
      .ant-status.error{border-left-color:var(--dsw-alias-state-error-primary)}.ant-status.success{border-left-color:var(--dsw-alias-state-success-primary)}.ant-status.warn{border-left-color:var(--dsw-alias-state-warn-primary)}
      .ant-empty,.ant-loading{display:grid;place-items:center;min-height:220px;padding:24px;color:var(--dsw-alias-label-secondary);text-align:center;font-size:12px}
      .ant-empty strong{display:block;margin-bottom:6px;color:var(--dsw-alias-label-primary)}
      .ant-stream{margin:0;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
      .ant-stream summary{padding:8px 16px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}
      .ant-stream ul{display:grid;gap:4px;margin:0;padding:0 16px 12px;list-style:none}
      .ant-stream li{display:flex;gap:8px;align-items:baseline;padding:5px 8px;border-left:2px solid var(--dsw-alias-state-idle-primary);background:var(--dsw-alias-bg-base);font-size:11px}
      .ant-stream li[data-kind=help]{border-left-color:var(--dsw-alias-state-error-primary)}
      .ant-stream li strong{min-width:78px;font-weight:650}.ant-stream p{margin:0 0 10px;padding:0 16px}
      .ant-note{color:var(--dsw-alias-label-secondary);font-size:11px}
      .ant-badge{position:absolute;top:-4px;right:-5px;min-width:14px;height:14px;padding:0 3px;border-radius:999px;background:var(--ant-neon-2);color:#04121a;font-size:9px;line-height:14px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}
    
      .ant-pop{position:absolute;top:34px;right:0;z-index:40;width:298px;border:1px solid var(--ant-neon);background:var(--dsw-alias-bg-layer-1);box-shadow:0 18px 42px rgb(0 0 0 / 24%);clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px))}
      .ant-pop-top{display:flex;align-items:baseline;gap:8px;padding:11px 13px 7px;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .ant-pop-top strong{font-size:12.5px;font-weight:650}.ant-pop-top span{margin-left:auto;color:var(--ant-neon-2);font-size:11px;font-variant-numeric:tabular-nums}
      .ant-roster{margin:0;padding:6px 6px 8px;list-style:none}
      .ant-roster li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;padding:4px 7px;font-size:11.5px}
      .ant-roster li:hover{background:var(--dsw-alias-bg-layer-2)}
      .ant-roster-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ant-pop-bot{display:flex;align-items:center;gap:8px;padding:9px 13px;border-top:1px solid var(--dsw-alias-border-l1)}
      .ant-pop-bot .ant-button{height:26px;min-height:26px;font-size:11px}
      .ant-pop-bot span{color:var(--dsw-alias-label-secondary);font-size:10.5px}
      @supports (color:light-dark(#000,#fff)){.ant-launcher{color:light-dark(#0a7d92,#16d9ed);border-color:light-dark(rgba(10,125,146,.55),rgba(22,217,237,.6));background:light-dark(rgba(255,255,255,.94),rgba(5,9,17,.92))}}

.ant-seat{position:relative;display:inline-flex;align-items:center;flex:none}
.ant-seat-btn{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:11px;letter-spacing:.02em}
.ant-seat-btn:hover,.ant-seat-btn[aria-expanded=true]{border-color:var(--ant-neon);color:var(--ant-neon)}
.ant-seat-btn:focus-visible{outline:1px solid var(--ant-neon);outline-offset:1px}
.ant-seat-name{white-space:nowrap}
.ant-seat-life{color:var(--dsw-alias-label-secondary);font:9.5px var(--ant-mono);letter-spacing:.1em;text-transform:uppercase;opacity:.85}
.ant-seat .ant-badge{position:static;top:auto;right:auto}
.ant-pop-up{top:auto;bottom:calc(100% + 8px);left:0;right:auto;z-index:80;width:min(340px,calc(100vw - 32px));max-height:min(64vh,460px);overflow:auto}
.ant-model{display:inline-flex;align-items:center;max-width:132px;padding:1px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:10px var(--ant-mono);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ant-model:hover,.ant-model[aria-expanded=true]{border-color:var(--ant-neon);color:var(--ant-neon)}
.ant-models{grid-column:1/-1;display:grid;gap:3px;margin:2px 0 4px;padding:6px 7px;border:1px solid var(--dsw-alias-border-l1);border-left:2px solid var(--ant-neon);background:var(--dsw-alias-bg-layer-2)}
.ant-models .ant-cap{margin:2px 0 0}
.ant-model-group{display:grid;gap:1px}
.ant-model-pick{display:block;width:100%;padding:3px 6px;border:0;border-radius:2px;background:transparent;color:var(--dsw-alias-label-primary);font-size:11px;text-align:left;cursor:pointer}
.ant-model-pick:hover{background:var(--ant-row-hover);color:var(--ant-neon)}
.ant-model-pick[aria-pressed=true]{color:var(--ant-neon)}
.ant-model-pick[aria-pressed=true]::before{content:"● ";font-size:8px}
.ant-link{padding:0;border:0;background:transparent;color:var(--ant-neon);font-size:11px;cursor:pointer}
.ant-link:hover{text-decoration:underline}

      @keyframes ant-flow{to{stroke-dashoffset:-24}}
      @media(prefers-reduced-motion:reduce){.ant-conduit-core{animation:none}.ant-chamber{transition:none}}
      @media(max-width:1024px){.ant-body{grid-template-columns:minmax(0,1fr)}.ant-nest-plan{min-height:0}.ant-rail{border-top:1px solid var(--dsw-alias-border-l1);border-left:0}}
      @media(max-width:768px){.ant-header{grid-template-columns:1fr auto}.ant-header .ant-meta{display:none}.ant-nest-plan{min-height:320px}.ant-pop{right:auto;left:0}}
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
    const STAGES = ['nursery', 'gate', 'corridor', 'pantry', 'refuse'];
    const ACTIVE_ATTEMPT = ['queued', 'running', 'paused'];
    const CHAMBER_CENTERS = { nursery: [17, 26], corridor: [50, 50], pantry: [83, 26], refuse: [17, 74], gate: [83, 74] };

    /** One task lives in exactly one chamber; the five chambers partition the view. */
    function pendingReleaseTasks(view) { return view?.releaseQueue ?? []; }
    /** Unread mail is the Host's summary count; the panel never recomputes receipts itself. */
    function unreadMail(view) { return view?.summary?.unread?.total ?? 0; }
    function activitySummary(view) {
      const holding = (view?.attempts ?? []).filter(item => ACTIVE_ATTEMPT.includes(item.state));
      const busy = new Set(holding.map(item => item.memberId));
      const idle = (view?.members ?? []).filter(member => member.status === 'active' && !busy.has(member.memberId)).length;
      const broken = (view?.tasks ?? []).filter(task => task.state === 'anomalous' || task.state === 'failed').length;
      return { running: holding.length, idle, needsHelp: broken + (view?.interruptions ?? []).length };
    }
    function chamberOf(task, attempts) {
      if (task.state === 'reviewed') return 'gate';
      if (task.state === 'completed' || task.state === 'released') return 'pantry';
      const own = (attempts ?? []).filter(item => item.taskId === task.taskId);
      if (own.some(item => ACTIVE_ATTEMPT.includes(item.state))) return 'corridor';
      if (task.state === 'anomalous' || task.state === 'failed') return 'refuse';
      if (own.length && own.every(item => item.state === 'terminated')) return 'refuse';
      return 'nursery';
    }
    function chamberCounts(view) {
      const attempts = view?.attempts ?? [];
      const counts = { nursery: 0, gate: 0, corridor: 0, pantry: 0, refuse: 0 };
      for (const task of view?.tasks ?? []) counts[chamberOf(task, attempts)] += 1;
      return counts;
    }
    function heldStage(member, attempts, tasks) {
      const holding = attempts.find(item => item.memberId === member.memberId && ACTIVE_ATTEMPT.includes(item.state));
      const task = holding && tasks.find(item => item.taskId === holding.taskId);
      return task ? chamberOf(task, attempts) : 'nursery';
    }


    const ANTS_VIEWBOX = '0 0 1100 760';
    const CHAMBER_BOX = {
      nursery: { left: '9.1%', top: '23.7%', width: '29.1%', height: '21.1%' },
      gate: { left: '62.7%', top: '14.5%', width: '28.2%', height: '19.8%' },
      corridor: { left: '42.0%', top: '41.1%', width: '16.2%', height: '22.1%' },
      pantry: { left: '62.7%', top: '63.8%', width: '28.2%', height: '20.4%' },
      refuse: { left: '10.0%', top: '67.1%', width: '25.5%', height: '17.1%' },
    };
    const CONDUITS = [
      'M550 58 V146 L536 160 V236 L550 250 V366 L536 380 V436 L550 450 V576 L536 590 V700',
      'M550 160 H620 L690 185',
      'M540 250 H474 L420 260',
      'M550 450 H610 L690 562',
      'M550 590 H468 L390 575',
    ];
    const JUNCTIONS = [[550, 160], [540, 250], [550, 450], [550, 590], [690, 185], [420, 260], [690, 562], [390, 575], [550, 58]];

    /** One solid silhouette, currentColor, no outline — the same ant used at every size. */
    /** One solid silhouette, currentColor, no outline — the same ant used at every size. */

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

    function blueprint(tunnels) {
      return h('svg', { className: 'ant-blueprint', viewBox: ANTS_VIEWBOX, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' },
        h('g', { className: 'ant-circuit' },
          h('path', { d: 'M60 70 H150 M60 70 V150' }), h('path', { d: 'M1040 70 H950 M1040 70 V150' }),
          h('path', { d: 'M60 690 H150 M60 690 V610' }), h('path', { d: 'M1040 690 H950 M1040 690 V610' }),
          h('path', { d: 'M380 70 H470 M420 70 V120' }), h('path', { d: 'M720 700 H820 M780 700 V660' })),
        h('g', null, CONDUITS.map((d, index) => h('path', { key: 'c' + index, className: 'ant-conduit', d }))),
        h('g', null, CONDUITS.map((d, index) => h('path', { key: 'k' + index, className: 'ant-conduit-core', d, style: { animationDelay: (index * 0.4) + 's' } }))),
        h('g', null, JUNCTIONS.map(([cx, cy]) => h('circle', { key: 'j' + cx + '-' + cy, className: 'ant-node', cx, cy, r: 4 }))),
        h('g', { className: 'ant-tunnels' }, (tunnels || []).map(tunnel => h('path', { key: tunnel.key, className: 'ant-tunnel', d: tunnel.path }))));
    }

    function chamber({ stage, tasks, members, count, state, locale, pending, dispatch, onSelectStage, onSelectTask, onSelectMember }) {
      const box = CHAMBER_BOX[stage];
      const shown = members.slice(0, 8);
      const hidden = members.length - shown.length;
      const isGate = stage === 'gate';
      const current = state.selectedStage === stage;
      return h('section', {
        key: stage, className: 'ant-chamber', 'data-stage': stage,
        style: { left: box.left, top: box.top, width: box.width, height: box.height },
        'aria-pressed': current === true ? 'true' : 'false', 'aria-label': locale.t(stage) + ' ' + count,
      },
        h('button', { type: 'button', className: 'ant-chamber-head', onClick: () => onSelectStage(current ? undefined : stage) },
          h('span', { className: 'ant-chamber-name' }, locale.t(stage)),
          h('span', { className: 'ant-chamber-count' }, String(count))),
        h('div', { className: 'ant-ants' },
          shown.map(member => h('button', {
            key: member.memberId, type: 'button', className: 'ant-ant', 'data-state': member.status ?? 'active',
            'aria-label': member.name ?? shortId(member.memberId),
            onClick: () => onSelectMember(member.memberId),
          }, h(AntShape, { size: 11 }))),
          hidden > 0 ? h('span', { className: 'ant-more' }, '+' + hidden) : null),
        h('div', { className: 'ant-rows' }, tasks.slice(0, 6).map(task => h('button', {
          key: task.taskId, type: 'button', className: 'ant-row', 'data-state': task.state ?? '',
          'aria-current': state.selectedTaskId === task.taskId ? 'true' : undefined,
          onClick: () => onSelectTask(task.taskId),
        }, h('span', null, task.title ?? task.taskId)))),
        isGate ? h('button', {
          type: 'button', className: 'ant-gate', 'data-gate': '',
          disabled: Boolean(state.request) || !pending.length,
          onClick: () => dispatch('batch.release', { batchId: 'batch-' + ((state.view?.cursor ?? 0) + 1), taskIds: pending.map(task => task.taskId) }),
          'aria-label': locale.t('releaseNow') + ' ' + pending.length,
        }, h('span', null, locale.t('gateOpen')), h('span', null, locale.t('pendingBatch') + ' ' + pending.length)) : null);
    }

    function Nest({ state, locale, dispatch, onSelectStage, onSelectTask, onSelectMember }) {
      const view = state.view ?? {};
      const attempts = view.attempts ?? [];
      const tasks = view.tasks ?? [];
      const members = (view.members ?? []).filter(item => item.status === 'active');
      const counts = chamberCounts(view);
      const pending = pendingReleaseTasks(view);
      const byStage = stage => tasks.filter(task => chamberOf(task, attempts) === stage);
      const tunnels = (view.plan?.dependencies ?? []).map(edge => {
        const blocker = tasks.find(item => item.taskId === edge.blockedByTaskId);
        const blocked = tasks.find(item => item.taskId === edge.taskId);
        if (!blocker || !blocked) return undefined;
        const from = CHAMBER_CENTERS[chamberOf(blocker, attempts)];
        const to = CHAMBER_CENTERS[chamberOf(blocked, attempts)];
        return { key: edge.blockedByTaskId + '-' + edge.taskId, path: 'M' + from[0] + ' ' + from[1] + ' L' + to[0] + ' ' + to[1] };
      }).filter(Boolean);
      const onKeyDown = event => {
        const index = ['1', '2', '3', '4', '5'].indexOf(event.key);
        if (index >= 0) {
          const stage = STAGES[index];
          event.preventDefault();
          onSelectStage(stage);
          if (stage === 'gate') {
            const gate = event.currentTarget.querySelector('[data-gate]');
            if (gate) gate.focus();
          }
          return;
        }
        if (event.key === 'Escape') onSelectStage(undefined);
      };
      return h('div', { className: 'ant-nest-plan', role: 'group', 'aria-label': locale.t('nest'), 'data-focus': state.selectedStage ? '' : undefined, onKeyDown },
        blueprint(tunnels),
        STAGES.map(stage => chamber({
          stage, count: counts[stage], tasks: byStage(stage),
          members: members.filter(member => heldStage(member, attempts, tasks) === stage),
          state, locale, pending, dispatch, onSelectStage, onSelectTask, onSelectMember,
        })));
    }

    function Rail({ state, locale, dispatch, onSelectMember }) {
      const view = state.view ?? {};
      const tasks = view.tasks ?? [];
      const attempts = view.attempts ?? [];
      const task = tasks.find(item => item.taskId === state.selectedTaskId);
      const member = (view.members ?? []).find(item => item.memberId === state.selectedMemberId);
      const attempt = task ? attempts.filter(item => item.taskId === task.taskId).at(-1) : undefined;
      const actions = [];
      if (task) {
        if (task.state === 'reviewed') actions.push(['batch.release', { batchId: 'batch-' + ((view.cursor ?? 0) + 1), taskIds: [task.taskId] }, locale.t('releaseTask')]);
        if (attempt?.state === 'running') actions.push(['attempt.pause', { taskId: task.taskId, attemptId: attempt.attemptId }, locale.t('pause')]);
        if (attempt?.state === 'paused') actions.push(['attempt.resume', { taskId: task.taskId, attemptId: attempt.attemptId }, locale.t('resume')]);
        if (attempt && ['running', 'paused', 'taken-over'].includes(attempt.state)) actions.push(['attempt.terminate', { taskId: task.taskId, attemptId: attempt.attemptId }, locale.t('terminate')]);
        if (!attempt && task.state === 'pending') actions.push(['task.claim', { taskId: task.taskId, memberId: view.leadMemberId ?? '' }, locale.t('claim')]);
      }
      if (member && !task) {
        const held = attempts.filter(item => item.memberId === member.memberId && ['running', 'paused', 'taken-over'].includes(item.state)).at(-1);
        if (held) {
          const target = { taskId: held.taskId, attemptId: held.attemptId };
          if (held.state === 'running') actions.push(['attempt.pause', target, locale.t('pause')]);
          if (held.state === 'paused') actions.push(['attempt.resume', target, locale.t('resume')]);
          actions.push(['attempt.takeover', target, locale.t('takeover')]);
          actions.push(['attempt.terminate', target, locale.t('terminate')]);
        }
      }
      if (!view.planConfirmed && view.planDigest) actions.push(['plan.confirm', { planDigest: view.planDigest }, locale.t('confirmPlan')]);
      if (['planned', 'completed'].includes(view.lifecycle)) actions.push(['team.archive', {}, locale.t('archive')]);
      if (view.lifecycle === 'archived') actions.push(['team.restore', {}, locale.t('restore')]);
      const title = task ? (task.title ?? task.taskId) : member ? (member.name ?? shortId(member.memberId)) : locale.t('inspector');
      const stateWord = task ? (TASK_WORD[task.state] ?? locale.t('unknown')) : member ? (member.status ?? locale.t('unknown')) : '—';
      const stateKey = task ? task.state : member ? member.status : undefined;
      const verify = task?.verify ?? [];
      return h('aside', { className: 'ant-inspector ant-rail', 'aria-label': locale.t('inspector') },
        h('h2', { id: 'ant-title' }, title),
        h('div', { className: 'ant-rail-state' }, h('i', { 'data-state': stateKey ?? '' }), locale.t(state === undefined ? 'inspector' : 'state'), ': ' + stateWord),
        verify.length ? h('p', { className: 'ant-cmd' }, verify.join('\n')) : null,
        member ? h('div', { className: 'ant-actions' },
          h('button', { type: 'button', className: 'ant-button', disabled: Boolean(state.request), onClick: () => dispatch('member.changeModel', { memberId: member.memberId, provider: member.provider, model: member.model }) }, locale.t('model') + ': ' + (member.model ?? member.provider ?? '—'))) : null,
        task ? h('dl', { className: 'ant-facts' },
          h('div', { className: 'ant-fact' }, h('dt', null, locale.t('owner')), h('dd', null, task.ownerMemberId ?? attempt?.memberId ?? '—')),
          h('div', { className: 'ant-fact' }, h('dt', null, locale.t('state')), h('dd', null, stateWord)),
          h('div', { className: 'ant-fact' }, h('dt', null, locale.t('quality')), h('dd', null, task.quality?.verdict ?? '—')),
          h('div', { className: 'ant-fact' }, h('dt', null, locale.t('evidence')), h('dd', null, String(attempt?.evidence?.length ?? 0)))) : null,
        h('div', { className: 'ant-rail-rule' }),
        h('p', { className: 'ant-cap' }, locale.t('gates')),
        h('ul', { className: 'ant-gates' }, GATES.map(gate => h('li', { key: gate[0] },
          h('i', { 'data-state': gateStateFor(task, gate[0]) }),
          h('b', null, locale.t(gate[0])),
          h('span', null, gateWord(task, gate[0], locale))))),
        actions.length ? h('div', { className: 'ant-actions' }, actions.map(([action, payload, label]) => h('button', {
          key: action, type: 'button', className: 'ant-button', disabled: Boolean(state.request),
          onClick: () => dispatch(action, payload),
        }, label))) : null,
        h('div', { className: 'ant-rail-rule' }),
        h('p', { className: 'ant-cap' }, locale.t('members')),
        h('ul', { className: 'ant-roster' }, (view.members ?? []).filter(item => item.status !== 'removed').map(item => h('li', { key: item.memberId },
          h(AntShape, { size: 10, className: 'ant-ant', 'data-state': item.status === 'active' ? 'active' : '' }),
          h('button', { type: 'button', className: 'ant-button', style: { border: 0, padding: 0, minHeight: 0, background: 'transparent', fontSize: 'inherit' }, onClick: () => onSelectMember(item.memberId) }, item.name ?? shortId(item.memberId)),
          h('em', null, item.model ?? item.provider ?? '—')))));
    }

    const GATES = [['requirement', 'requirement'], ['implementation', 'implementation'], ['verification', 'verification'], ['review', 'review'], ['integration', 'integration']];
    const TASK_WORD = { pending: 'nursery', running: 'corridor', reviewed: 'gate', completed: 'pantry', released: 'pantry', failed: 'refuse', anomalous: 'refuse' };
    function gateStateFor(task, key) {
      if (!task) return 'open';
      const quality = task.quality ?? {};
      if (key === 'requirement') return task.title ? 'pass' : 'open';
      if (key === 'implementation') return ['running', 'reviewed', 'completed', 'released'].includes(task.state) ? 'pass' : 'open';
      if (key === 'verification') return task.state === 'running' ? 'run' : (task.verify ?? []).length ? 'pass' : 'open';
      if (key === 'review') return quality.verdict === 'pass' ? 'pass' : task.state === 'reviewed' ? 'run' : 'open';
      return task.state === 'released' ? 'pass' : 'open';
    }
    function gateWord(task, key, locale) {
      const state = gateStateFor(task, key);
      return locale.t(state === 'pass' ? 'gatePass' : state === 'run' ? 'gateRunning' : 'gateOpenState');
    }

    function ActivityStream({ state, locale }) {
      const view = state.view ?? {};
      const summary = activitySummary(view);
      const tasks = view.tasks ?? [];
      const rows = [];
      for (const item of view.attempts ?? []) {
        if (!ACTIVE_ATTEMPT.includes(item.state)) continue;
        const task = tasks.find(entry => entry.taskId === item.taskId);
        rows.push({ key: item.attemptId, kind: 'running', label: shortId(item.memberId), detail: task?.title ?? item.taskId });
      }
      const busy = new Set((view.attempts ?? []).filter(item => ACTIVE_ATTEMPT.includes(item.state)).map(item => item.memberId));
      for (const member of view.members ?? []) {
        if (member.status !== 'active' || busy.has(member.memberId)) continue;
        rows.push({ key: 'idle-' + member.memberId, kind: 'idle', label: shortId(member.memberId), detail: member.role ?? locale.t('streamIdle') });
      }
      for (const item of view.interruptions ?? []) {
        rows.push({ key: 'stop-' + (item.attemptId ?? item.eventSeq), kind: 'help', label: shortId(item.memberId ?? item.attemptId), detail: item.reason ?? locale.t('streamHelp') });
      }
      for (const task of tasks) {
        if (task.state !== 'anomalous' && task.state !== 'failed') continue;
        rows.push({ key: 'bad-' + task.taskId, kind: 'help', label: shortId(task.taskId), detail: task.title ?? task.taskId });
      }
      return h('details', { className: 'ant-stream', 'data-stream': '' },
        h('summary', null, locale.t('stream') + ' · ' + locale.t('streamRunning') + ' ' + summary.running + ' · ' + locale.t('streamIdle') + ' ' + summary.idle + ' · ' + locale.t('streamHelp') + ' ' + summary.needsHelp),
        rows.length ? h('ul', null, rows.map(row => h('li', { key: row.key, className: 'ant-row', 'data-kind': row.kind }, h('strong', null, row.label), h('span', null, row.detail)))) : h('p', { className: 'ant-note' }, locale.t('noActivity')));
    }


    const LEVELS = ['L1', 'L2', 'L3'];
    const NUMBER_FIELDS = [['batchWindowMinutes', 'batchWindow', 1, 240], ['maxActiveAttempts', 'maxActive', 1, 8], ['defaultVariants', 'defaultVariants', 1, 3]];

    function statusText(state, locale) {
      if (state.request) return h('p', { className: 'ant-status warn', role: 'status' }, locale.t('dispatching') + ' ' + state.request.action);
      if (state.error) {
        const message = state.status === 'stale-cursor' ? locale.t('stale') : state.status === 'lease' ? locale.t('lease') : state.status === 'rebuild-required' ? locale.t('rebuild') : state.status === 'persistence-failed' ? locale.t('persistence') : state.status === 'not-found' ? locale.t('notFound') : locale.t('unavailable');
        return h('p', { className: 'ant-status error', role: 'alert' }, message + ' (' + state.error.code + ')');
      }
      if (state.receipt) return h('p', { className: 'ant-status success', role: 'status' }, (state.receipt.outcome === 'duplicate' ? locale.t('duplicate') : locale.t('committed')) + ' ' + (state.receipt.requestId ?? locale.t('unknown')));
      return state.status === 'refreshing' ? h('p', { className: 'ant-status', role: 'status' }, locale.t('refreshing')) : null;
    }

    function MainPanel({ model, locale }) {
      const state = useModel(model);
      const t = useLocale(locale);
      React.useEffect(() => { model.loadList(); }, [model]);
      const loading = state.status === 'loading' && !state.view && !state.teams.length;
      const selectMember = memberId => model.selectNode('member', memberId);
      return h('main', { className: 'ant-shell', 'aria-labelledby': 'ant-title' }, h(StyleSheet),
        h('header', { className: 'ant-header' },
          h('div', null,
            h('h1', { className: 'ant-title', id: 'ant-title' }, t.t('title')),
            h('p', { className: 'ant-subtitle' }, t.t('subtitle'))),
          h('label', { className: 'ant-meta' }, t.t('team'),
            h('select', { className: 'ant-select', value: state.selectedTeamId ?? '', disabled: !state.teams.length, onChange: event => model.selectTeam(event.target.value) },
              [h('option', { value: '', key: 'empty' }, t.t('team'))].concat(state.teams.map(team => h('option', { value: team.teamId, key: team.teamId }, team.goal ?? shortId(team.teamId)))))),
          h('div', { className: 'ant-meta' }, t.t('lifecycle'), h('strong', null, state.view?.lifecycle ?? t.t('unknown'))),
          h('div', { className: 'ant-meta' }, t.t('cursor'), h('strong', null, String(state.view?.cursor ?? '—'))),
          h('div', { className: 'ant-meta' }, t.t('unread'), h('strong', null, String(unreadMail(state.view)))),
          h('button', { type: 'button', className: 'ant-button', onClick: model.loadList, disabled: Boolean(state.request), 'aria-label': t.t('refresh') }, t.t('refresh'))),
        statusText(state, t),
        loading ? h('div', { className: 'ant-loading', role: 'status', 'aria-busy': 'true' }, t.t('loading'))
          : state.status === 'empty' ? h('div', { className: 'ant-empty', role: 'status' }, h('div', null, h('strong', null, t.t('empty')), h('span', null, t.t('emptyHint'))))
          : h('div', { className: 'ant-main', style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } },
            h('div', { className: 'ant-body' },
              h('section', { className: 'ant-nest', 'aria-label': t.t('nest') }, h(Nest, { state, locale: t, dispatch: model.dispatch, onSelectStage: model.selectStage, onSelectTask: taskId => model.selectNode('task', taskId), onSelectMember: memberId => model.selectNode('member', memberId) })),
              h(Rail, { state, locale: t, dispatch: model.dispatch, onSelectMember: selectMember })),
            h(ActivityStream, { state, locale: t })));
    }

    /** The single entry: one seat in the composer row that opens the colony popover. */
    function ColonySeat({ model, locale, layout, catalog }) {
      const state = useModel(model);
      const t = useLocale(locale);
      const [open, setOpen] = React.useState(false);
      const [picker, setPicker] = React.useState(undefined);
      const [groups, setGroups] = React.useState(undefined);
      const [catalogFailed, setCatalogFailed] = React.useState(false);
      React.useEffect(() => { model.ensureLoaded(); }, [model]);
      React.useEffect(() => {
        if (picker === undefined || groups !== undefined) return undefined;
        let live = true;
        (async () => {
          try {
            const directory = catalog();
            if (!directory) throw new Error('no model directory');
            await directory.load();
            if (live) setGroups(directory.store.getSnapshot().groups ?? []);
          } catch (error) { if (live) setCatalogFailed(true); }
        })();
        return () => { live = false; };
      }, [picker, groups, catalog]);
      const view = state.view ?? {};
      const pending = pendingReleaseTasks(view);
      const unread = unreadMail(view);
      const members = (view.members ?? []).filter(member => member.status !== 'removed');
      const badge = pending.length || unread;
      const label = t.t('panel');
      const choose = (member, group, item) => {
        setPicker(undefined);
        model.dispatch('member.changeModel', { memberId: member.memberId, provider: group.id, model: item.id });
      };
      const release = () => model.dispatch('batch.release', {
        batchId: 'batch-' + ((view.cursor ?? 0) + 1),
        taskIds: pending.map(task => task.taskId),
      });
      const modelList = member => {
        if (catalogFailed) return h('p', { className: 'ant-note' }, t.t('unavailable'));
        if (groups === undefined) return h('p', { className: 'ant-note' }, t.t('loading'));
        if (groups.length === 0) return h('p', { className: 'ant-note' }, t.t('empty'));
        return groups.map(group => h('div', { key: group.id, className: 'ant-model-group' },
          h('span', { className: 'ant-cap' }, group.id),
          (group.models ?? []).map(item => h('button', {
            key: group.id + ':' + item.id,
            type: 'button',
            className: 'ant-model-pick',
            'data-model': item.id,
            'aria-pressed': item.id === member.model && group.id === member.provider ? 'true' : 'false',
            onClick: () => choose(member, group, item),
          }, item.label ?? item.id))));
      };
      const row = member => h('li', { key: member.memberId },
        h(AntShape, { size: 10, className: 'ant-ant', 'data-state': member.status === 'active' ? 'active' : '' }),
        h('span', { className: 'ant-roster-name' }, member.name ?? shortId(member.memberId)),
        h('button', {
          type: 'button',
          className: 'ant-model',
          'data-member': member.memberId,
          title: t.t('model'),
          'aria-expanded': picker === member.memberId ? 'true' : 'false',
          onClick: () => setPicker(picker === member.memberId ? undefined : member.memberId),
        }, (member.model ?? member.provider ?? '—') + ' ▾'),
        picker === member.memberId ? h('div', { className: 'ant-models' }, modelList(member)) : null);
      return h('span', { className: 'ant-seat' },
        h('button', {
          type: 'button',
          className: 'ant-seat-btn',
          'data-ant-seat': '',
          'data-pending': pending.length || undefined,
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': label,
          title: label + (badge ? ' · ' + badge : ''),
          onClick: () => setOpen(!open),
          onKeyDown: event => { if (event.key === 'Escape') { setOpen(false); setPicker(undefined); } },
        },
          h(AntShape, { size: 13 }),
          h('span', { className: 'ant-seat-name' }, label),
          h('span', { className: 'ant-seat-life' }, view.lifecycle ?? '—'),
          badge ? h('span', { className: 'ant-badge', 'aria-hidden': 'true' }, String(badge)) : null),
        open ? h('div', { className: 'ant-pop ant-pop-up', role: 'dialog', 'aria-label': label },
          h('div', { className: 'ant-pop-top' },
            h('strong', null, view.goal ?? label),
            h('span', null, [view.lifecycle ?? '—', pending.length ? pending.length + ' ' + t.t('pendingBadge') : null].filter(Boolean).join(' · '))),
          h('ul', { className: 'ant-roster' }, members.length ? members.map(row) : h('li', { key: 'none' }, t.t('empty'))),
          h('div', { className: 'ant-pop-bot' },
            h('button', {
              type: 'button', className: 'ant-button',
              disabled: Boolean(state.request) || !pending.length,
              onClick: release,
            }, t.t('releaseNow') + ' ' + pending.length),
            h('button', { type: 'button', className: 'ant-link', onClick: () => { setOpen(false); openNest(layout); } }, t.t('openNest') + ' ›'),
            h('span', null, members.length + ' ' + t.t('members')))) : null);
    }

    function StyleSheet() { return h('style', { 'data-ant': 'styles' }, CSS); }

    /** Resolve the Host model catalogue for this Session without hard-depending on it. */
    function directoryOf(ctx, sessionId) {
      try {
        const directories = typeof ctx.get === 'function' ? ctx.get('modelDirectories') : undefined;
        if (!directories || sessionId === undefined) return undefined;
        return directories.directoryFor(sessionId);
      } catch (error) { trace('catalog-failed', error); return undefined; }
    }

    function openNest(layout) {
      if (typeof layout?.selectPanel !== 'function') return false;
      try {
        layout.selectPanel(PANEL_ID);
        return true;
      } catch {
        return false;
      }
    }

    function layoutOf(ctx) {
      try {
        return typeof ctx?.get === 'function' ? ctx.get('layout') : ctx?.layout;
      } catch {
        return undefined;
      }
    }

    function registerSurfaces(ctx, model, locale) {
      const disposers = [];
      const bind = (slot, options, component) => {
        try {
          disposers.push(ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, locale: LOCALE_NS, ...options, inject: options.inject ?? (() => ({ model, locale })) }, component)));
          trace('bind:' + slot);
        } catch (error) {
          trace('bind-failed:' + slot, error);
        }
      };
      bind('main', { key: PANEL_ID }, MainPanel);
      bind('conversation.input.left', {
        id: PANEL_ID, order: 10,
        inject: sessionId => ({ model, locale, layout: layoutOf(ctx), catalog: () => directoryOf(ctx, sessionId) }),
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
          try {
            locale = createLocale(remoteCtx);
            trace('locale-created');
            model = createController(remoteCtx.remote.team);
            trace('model-created');
            remoteCtx.effect(() => remoteCtx.locale.register(LOCALE_NS, DICT), 'ant: locale');
            trace('locale-registered');
            remoteCtx.effect(() => locale.dispose, 'ant: locale subscription');
            remoteCtx.effect(() => model.dispose, 'ant: model');
            for (const dispose of registerSurfaces(remoteCtx, model, locale)) remoteCtx.effect(() => dispose, 'ant: surface');
            trace('surfaces-registered');
            if (DEBUG) setTimeout(() => {
              try {
                const count = selector => document.querySelectorAll(selector).length;
                trace('dom-probe', JSON.stringify({
                  shell: count('.ant-shell'),
                  seat: count('[data-ant-seat]'),
                }));
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
