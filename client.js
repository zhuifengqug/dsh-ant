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
      close: 'Close', idle: 'idle', searchModels: 'Search models', noMatch: 'No model matches',
      addTask: 'Add task', editTask: 'Edit task', taskTitle: 'Title', taskObjective: 'Objective', taskAcceptance: 'Acceptance (separate with ;)',
      save: 'Save', cancel: 'Cancel', confirmPlan: 'Confirm plan',
      stateQueued: 'queued', stateRunning: 'running', statePaused: 'paused', stateTakenOver: 'taken over',
      statePending: 'waiting', stateReviewed: 'ready to release', stateReleased: 'released', stateCompleted: 'done',
      stateFailed: 'failed', stateAnomalous: 'anomalous', stateTerminated: 'stopped',
    });
    Object.assign(DICT.zh, {
      close: '关闭', idle: '空闲', searchModels: '搜索模型', noMatch: '没有匹配的模型',
      addTask: '新增任务', editTask: '修改任务', taskTitle: '标题', taskObjective: '目标', taskAcceptance: '验收标准（用；分隔）',
      save: '保存', cancel: '取消', confirmPlan: '确认计划',
      stateQueued: '排队', stateRunning: '进行中', statePaused: '已暂停', stateTakenOver: '已接管',
      statePending: '等待', stateReviewed: '待放行', stateReleased: '已放行', stateCompleted: '已完成',
      stateFailed: '失败', stateAnomalous: '异常', stateTerminated: '已终止',
    });

const STYLES = `[data-ant-ui] .badge{
  position: absolute;
  top: 64px;
  right: 18px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 12px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-bg-module-platform) 92%, transparent);
  backdrop-filter: blur(16px);
  box-shadow: 0 8px 28px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 29%, transparent);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  cursor: pointer;
  transition: border-color 150ms ease, transform 120ms ease;
}
[data-ant-ui] .badge:hover{
  border-color: var(--dsw-alias-border-l3);
  transform: translateY(-1px);
}
[data-ant-ui] .badge:active{
  transform: translateY(0) scale(0.98);
}
[data-ant-ui] .badge:focus-visible,[data-ant-ui] .iconButton:focus-visible,[data-ant-ui] .memberRow:focus-visible,[data-ant-ui] .membersToggle:focus-visible,[data-ant-ui] .sectionToggleTitle:focus-visible,[data-ant-ui] .dagNode:focus-visible{
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
[data-ant-ui] .badgeDot,[data-ant-ui] .panelDot{
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
}
[data-ant-ui] .badgeDot[data-busy='true'],[data-ant-ui] .panelDot[data-busy='true']{
  background: var(--dsw-alias-state-business-primary);
  animation: agentTeamsPulse 1.25s ease-in-out infinite;
}
[data-ant-ui] .badgeCount,[data-ant-ui] .memberCount,[data-ant-ui] .teamStats,[data-ant-ui] .stageLabel,[data-ant-ui] .taskId{
  font-variant-numeric: tabular-nums;
}
[data-ant-ui] .panel{
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l3) 58%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 95%, transparent);
  backdrop-filter: blur(20px) saturate(1.08);
  box-shadow:
    0 12px 32px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 25%, transparent),
    0 32px 72px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 33%, transparent);
  animation: agentTeamsPanelIn 160ms ease-out;
  will-change: transform;
}
[data-ant-ui] .panel[data-dragging],[data-ant-ui] .panel[data-resizing]{
  user-select: none;
  box-shadow:
    0 16px 38px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 29%, transparent),
    0 36px 78px color-mix(in srgb, var(--dsw-alias-bg-mask-3) 38%, transparent);
}
@keyframes agentTeamsPanelIn {
  from { opacity: 0; }
[data-ant-ui] to{ opacity: 1; }
@keyframes agentTeamsPulse {
  0%, 100% { opacity: 0.42; }
[data-ant-ui] 50%{ opacity: 1; }
[data-ant-ui] .panelHead{
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  padding: 0 14px 0 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  cursor: grab;
  touch-action: none;
}
[data-ant-ui] .panelHead:active,[data-ant-ui] .panel[data-dragging] .panelHead{
  cursor: grabbing;
}
[data-ant-ui] .panel[data-compact] .panelHead{
  cursor: default;
  touch-action: auto;
}
[data-ant-ui] .panelTitle{
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}
[data-ant-ui] .panelControls{
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
}
[data-ant-ui] .iconButton{
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
}
[data-ant-ui] .iconButton:hover{
  background: var(--dsw-alias-button-ghost-active-fill);
  color: var(--dsw-alias-label-primary);
}
[data-ant-ui] .iconButton:active{
  transform: scale(0.94);
}
[data-ant-ui] .iconButton[data-control='dock'][data-mode='docked'] svg{
  transform: scaleX(-1);
}
[data-ant-ui] .resizeHandle{
  position: absolute;
  z-index: 5;
  touch-action: none;
  pointer-events: auto;
}
[data-ant-ui] .resizeHandle[data-resize-edge='left']{
  top: 44px;
  bottom: 14px;
  left: 0;
  width: 14px;
  cursor: ew-resize;
}
[data-ant-ui] .resizeHandle[data-resize-edge='left']::after{
  position: absolute;
  top: 50%;
  left: 4px;
  width: 3px;
  height: 48px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 42%, transparent);
  content: '';
  opacity: 0.45;
  transform: translateY(-50%);
  transition: background-color 120ms ease, opacity 120ms ease;
}
[data-ant-ui] .resizeHandle[data-resize-edge='bottom']{
  right: 20px;
  bottom: 0;
  left: 20px;
  height: 14px;
  cursor: ns-resize;
}
[data-ant-ui] .resizeHandle[data-resize-edge='bottom']::after{
  position: absolute;
  bottom: 4px;
  left: 50%;
  width: 48px;
  height: 3px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 42%, transparent);
  content: '';
  opacity: 0.45;
  transform: translateX(-50%);
  transition: background-color 120ms ease, opacity 120ms ease;
}
[data-ant-ui] .resizeHandle[data-resize-edge='corner']{
  right: 0;
  bottom: 0;
  width: 28px;
  height: 28px;
  cursor: nwse-resize;
}
[data-ant-ui] .resizeHandle[data-resize-edge='corner']::after{
  position: absolute;
  right: 6px;
  bottom: 6px;
  width: 10px;
  height: 10px;
  border-right: 2px solid var(--dsw-alias-label-tertiary);
  border-bottom: 2px solid var(--dsw-alias-label-tertiary);
  content: '';
  opacity: 0.58;
  transition: border-color 120ms ease, opacity 120ms ease;
}
[data-ant-ui] .resizeHandle:hover::after,[data-ant-ui] .panel[data-resizing] .resizeHandle::after{
  background-color: var(--dsw-alias-state-business-primary);
  border-color: var(--dsw-alias-state-business-primary);
  opacity: 0.95;
}
[data-ant-ui] .teams{
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent) transparent;
  scrollbar-width: thin;
}
[data-ant-ui] .teams::-webkit-scrollbar{
  width: 6px;
}
[data-ant-ui] .teams::-webkit-scrollbar-track{
  background: transparent;
}
[data-ant-ui] .teams::-webkit-scrollbar-thumb{
  border: 2px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 28%, transparent);
  background-clip: padding-box;
}
[data-ant-ui] .teams:hover::-webkit-scrollbar-thumb{
  background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 44%, transparent);
  background-clip: padding-box;
}
[data-ant-ui] .team{
  container-name: agent-team;
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 14px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
[data-ant-ui] .team:last-child{
  border-bottom: 0;
}
[data-ant-ui] .teamHead{
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
[data-ant-ui] .teamName{
  overflow: hidden;
  flex: 1;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .teamStats{
  display: inline-flex;
  flex: none;
  gap: 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10.5px;
  line-height: 16px;
  white-space: nowrap;
}
[data-ant-ui] .teamStopButton{
  display: grid;
  width: 26px;
  height: 26px;
  flex: none;
  place-items: center;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, color 150ms ease;
}
[data-ant-ui] .teamStopButton:hover{
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 42%, var(--dsw-alias-border-l2));
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, transparent);
  color: var(--dsw-alias-state-error-primary);
}
[data-ant-ui] .teamStopButton:focus-visible{
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
[data-ant-ui] .stopModalActions{
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
[data-ant-ui] .stopModalActions button{
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 13px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-button-ghost-active-fill);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}
[data-ant-ui] .stopModalActions button[data-danger]{
  border-color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-inverted);
}
[data-ant-ui] .stopModalActions button:disabled{
  cursor: wait;
  opacity: 0.58;
}
[data-ant-ui] .stopModalError{
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 0;
  padding: 9px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}
[data-ant-ui] .stopModalError svg{
  flex: none;
  margin-top: 1px;
}
[data-ant-ui] .sectionHead{
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
[data-ant-ui] .sectionTitle{
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
}
[data-ant-ui] .sectionHint{
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .delegationSection{
  min-width: 0;
}
[data-ant-ui] .captainNode{
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
  min-height: 56px;
  padding: 6px 10px;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 32%, var(--dsw-alias-border-l2));
  border-radius: 10px;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-layer-1));
}
[data-ant-ui] .captainAvatar,[data-ant-ui] .memberAvatar{
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
}
[data-ant-ui] .captainAvatar{
  width: 46px;
  height: 46px;
}
[data-ant-ui] .leadAvatar,[data-ant-ui] .memberArt{
  border: 0;
  border-radius: 0;
  object-fit: contain;
  background: transparent;
  filter: drop-shadow(0 1px 1px rgb(18 45 72 / 20%));
}
[data-ant-ui] .leadAvatar{
  width: 44px;
  height: 44px;
}
[data-ant-ui] .memberArt{
  width: 40px;
  height: 40px;
}
[data-ant-ui] .captainInfo,[data-ant-ui] .memberInfo{
  display: flex;
  flex-direction: column;
  min-width: 0;
}
[data-ant-ui] .captainInfo{
  gap: 2px;
}
[data-ant-ui] .captainLine,[data-ant-ui] .memberLine{
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
[data-ant-ui] .captainName,[data-ant-ui] .memberName{
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .captainRole,[data-ant-ui] .memberRole{
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .captainSummary,[data-ant-ui] .memberStatusLine{
  overflow: hidden;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .taskDetailModel{
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .memberModel{
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  min-width: 0;
  max-width: 132px;
  padding: 0 6px;
  overflow: hidden;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-button-ghost-active-fill);
  color: var(--dsw-alias-label-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9px;
  font-weight: 600;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .captainState,[data-ant-ui] .memberState{
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  font-weight: 500;
  line-height: 15px;
  white-space: nowrap;
}
[data-ant-ui] .captainState[data-busy='true'],[data-ant-ui] .memberState[data-activity='working']{
  color: var(--dsw-alias-state-business-primary);
}
[data-ant-ui] .workGlyph rect{
  opacity: 0.5;
}
[data-ant-ui] .workGlyph[data-active='true'] rect{
  animation: agentTeamsDot 1.1s ease-in-out infinite;
}
@keyframes agentTeamsDot {
  0%, 100% { opacity: 0.25; }
[data-ant-ui] 50%{ opacity: 1; }
[data-ant-ui] .progressOverview{
  display: flex;
  flex-direction: column;
  gap: 7px;
}
[data-ant-ui] .progressTitle{
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
}
[data-ant-ui] .progressSegments{
  display: flex;
  gap: 3px;
}
[data-ant-ui] .progressSegments > span,[data-ant-ui] .progressEmpty{
  flex: 1;
  height: 5px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l3);
}
[data-ant-ui] .progressEmpty{
  display: block;
  width: 100%;
}
[data-ant-ui] .progressSegments > span[data-state='running']{
  background: var(--dsw-alias-state-business-primary);
}
[data-ant-ui] .progressSegments > span[data-state='blocked']{
  background: var(--dsw-alias-state-warn-primary);
}
[data-ant-ui] .progressSegments > span[data-state='completed']{
  background: var(--dsw-alias-state-success-primary);
}
[data-ant-ui] .progressSegments > span[data-state='failed']{
  background: var(--dsw-alias-state-error-primary);
}
[data-ant-ui] .progressSegments > span[data-state='cancelled']{
  opacity: 0.55;
}
[data-ant-ui] .progressLegend{
  display: flex;
  gap: 10px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 9.5px;
  line-height: 14px;
}
[data-ant-ui] .progressLegend > span[data-state='running']{
  color: var(--dsw-alias-state-business-primary);
}
[data-ant-ui] .progressLegend > span[data-state='blocked']{
  color: var(--dsw-alias-state-warn-primary);
}
[data-ant-ui] .progressLegend > span[data-state='completed']{
  color: var(--dsw-alias-state-success-primary);
}
[data-ant-ui] .progressSummary{
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-layer-1));
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
}
[data-ant-ui] .progressSummary[data-state='warning']{
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, var(--dsw-alias-bg-layer-1));
}
[data-ant-ui] .progressSummary[data-state='completed']{
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 8%, var(--dsw-alias-bg-layer-1));
}
[data-ant-ui] .progressSummary[data-state='discarded']{
  background: var(--dsw-alias-button-ghost-active-fill);
}
[data-ant-ui] .progressSummary > span:last-child{
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .progressSummaryDot{
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
}
[data-ant-ui] .progressSummary[data-state='warning'] .progressSummaryDot{
  background: var(--dsw-alias-state-warn-primary);
}
[data-ant-ui] .progressSummary[data-state='completed'] .progressSummaryDot{
  background: var(--dsw-alias-state-success-primary);
}
[data-ant-ui] .progressSummary[data-state='discarded'] .progressSummaryDot{
  background: var(--dsw-alias-label-tertiary);
}
[data-ant-ui] .membersToggle{
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 10.5px;
  font-weight: 600;
  line-height: 15px;
  cursor: pointer;
}
[data-ant-ui] .membersToggle:hover{
  background: var(--dsw-alias-button-ghost-active-fill);
}
[data-ant-ui] .membersToggle > span{
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
[data-ant-ui] .membersToggle > span:last-child{
  color: var(--dsw-alias-state-business-primary);
}
[data-ant-ui] .chevron{
  flex: none;
  transition: transform 140ms ease;
}
[data-ant-ui] .chevron[data-open='true']{
  transform: rotate(90deg);
}
[data-ant-ui] .delegationTree{
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-left: 18px;
  padding: 9px 0 0 20px;
}
[data-ant-ui] .delegationTree::before{
  position: absolute;
  top: 0;
  bottom: 22px;
  left: 0;
  width: 1px;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 48%, var(--dsw-alias-border-l2));
  content: '';
}
[data-ant-ui] .memberBlock{
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 3px 0 7px;
}
[data-ant-ui] .memberBranch{
  position: absolute;
  top: 27px;
  right: 100%;
  display: block;
  width: 20px;
  height: 1px;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 48%, var(--dsw-alias-border-l2));
}
[data-ant-ui] .memberBranch::before{
  position: absolute;
  top: -2px;
  right: -1px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
  content: '';
}
[data-ant-ui] .memberRow{
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: 48px;
  padding: 4px 6px;
  box-sizing: border-box;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease, transform 120ms ease;
}
[data-ant-ui] .memberRow:hover,[data-ant-ui] .memberRow[data-activity='working']{
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-layer-1));
}
[data-ant-ui] .memberRow:active{
  transform: scale(0.995);
}
[data-ant-ui] .memberAvatar{
  width: 42px;
  height: 42px;
}
[data-ant-ui] .memberAvatar[data-unread='true']::after{
  position: absolute;
  top: 0;
  right: -1px;
  width: 6px;
  height: 6px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-bg-layer-1);
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
  content: '';
  animation: agentTeamsUnreadPulse 1.8s ease-in-out infinite;
}
@keyframes agentTeamsUnreadPulse {
  0%, 100% { opacity: 0.78; transform: scale(0.92); }
[data-ant-ui] 50%{ opacity: 1; transform: scale(1.16); }
[data-ant-ui] .memberInitial{
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary-inverted);
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}
[data-ant-ui] .stateArt{
  position: absolute;
  right: -5px;
  bottom: -3px;
  width: 22px;
  height: 22px;
  box-sizing: border-box;
  border: 0;
  border-radius: 0;
  object-fit: contain;
  background: transparent;
  filter:
    drop-shadow(0 0 1px var(--dsw-alias-bg-layer-1))
    drop-shadow(0 1px 1px rgb(18 45 72 / 24%));
}
[data-ant-ui] .stateArt[data-activity='working']{
  animation: agentTeamsFloat 2.4s ease-in-out infinite;
}
[data-ant-ui] .stateArt[data-activity='idle']{
  animation: agentTeamsBreathe 4.2s ease-in-out infinite;
}
[data-ant-ui] .stateArt[data-activity='unknown']{
  animation: agentTeamsThink 2.8s ease-in-out infinite;
}
@keyframes agentTeamsFloat {
  0%, 100% { transform: translateY(0) rotate(-4deg); }
[data-ant-ui] 50%{ transform: translateY(-2px) rotate(4deg); }
@keyframes agentTeamsBreathe {
  0%, 100% { opacity: 0.82; transform: scale(1); }
[data-ant-ui] 50%{ opacity: 1; transform: scale(1.06); }
@keyframes agentTeamsThink {
  0%, 100% { transform: rotate(-7deg); }
[data-ant-ui] 50%{ transform: rotate(7deg); }
[data-ant-ui] .memberState{
  margin-left: auto;
}
[data-ant-ui] .memberCount{
  color: var(--dsw-alias-label-tertiary);
  font-size: 10.5px;
  line-height: 16px;
}
[data-ant-ui] .assignmentLine{
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 0 6px 0 60px;
}
[data-ant-ui] .assignmentLabel{
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 9.5px;
  line-height: 14px;
}
[data-ant-ui] .assignmentTasks{
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
[data-ant-ui] .assignmentChip{
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: 16px;
  padding: 0 5px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--dsw-alias-button-ghost-active-fill);
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .assignmentChip[data-state='running']{
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary-inverted);
}
[data-ant-ui] .assignmentChip[data-state='completed']{
  background: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-label-primary-inverted);
}
[data-ant-ui] .assignmentChip[data-state='blocked']{
  background: var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-label-primary-inverted);
}
[data-ant-ui] .assignmentChip[data-state='failed']{
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-inverted);
}
[data-ant-ui] .assignmentChip[data-state='cancelled']{
  color: var(--dsw-alias-label-tertiary);
  text-decoration: line-through;
}
[data-ant-ui] .unreadPill{
  flex: none;
  color: var(--dsw-alias-state-business-primary);
  font-size: 9.5px;
  font-weight: 600;
  line-height: 14px;
  white-space: nowrap;
}
[data-ant-ui] .taskEmpty{
  color: var(--dsw-alias-label-tertiary);
  font-size: 9.5px;
  line-height: 14px;
}
[data-ant-ui] .dependencySection{
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding-top: 10px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
[data-ant-ui] .sectionToggleTitle{
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  cursor: pointer;
}
[data-ant-ui] .dagViewport{
  min-width: 0;
  overflow-x: auto;
  padding: 2px 0 4px;
  scrollbar-width: thin;
}
[data-ant-ui] .dagCanvas{
  position: relative;
  min-width: 100%;
}
[data-ant-ui] .dagCanvas[data-layout='parallel']{
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
[data-ant-ui] .dagCanvas[data-layout='parallel'] .dagNode{
  position: relative;
  flex: 1 1 92px;
  min-width: 92px;
}
[data-ant-ui] .dagEdges{
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}
[data-ant-ui] .dagEdges path{
  fill: none;
  stroke: var(--dsw-alias-border-l3);
  stroke-width: 1;
  transition: opacity 140ms ease, stroke 140ms ease, stroke-width 140ms ease;
}
[data-ant-ui] .dagEdges path[data-active='true']{
  stroke: var(--dsw-alias-state-business-primary);
  stroke-width: 1.6;
}
[data-ant-ui] .dagEdges path[data-dimmed='true']{
  opacity: 0.24;
}
[data-ant-ui] .dagNode{
  position: absolute;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 0 6px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease, opacity 140ms ease;
}
[data-ant-ui] .dagNode:hover,[data-ant-ui] .dagNode[data-focused='true']{
  border-color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-layer-1));
}
[data-ant-ui] .dagNode[data-dimmed='true']{
  opacity: 0.3;
}
[data-ant-ui] .dagNode[data-state='running'][data-dimmed='true']{
  opacity: 0.58;
}
[data-ant-ui] .dagNode[data-state='completed']{
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 48%, var(--dsw-alias-border-l2));
}
[data-ant-ui] .dagNode[data-state='blocked']{
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 52%, var(--dsw-alias-border-l2));
}
[data-ant-ui] .dagNode[data-state='failed']{
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 56%, var(--dsw-alias-border-l2));
}
[data-ant-ui] .dagNode[data-verdict-stale='true']{
  border-style: dashed;
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 62%, var(--dsw-alias-border-l2));
}
[data-ant-ui] .dagNode[data-verdict-stale='true'] .dagNodeHead{
  color: var(--dsw-alias-state-warn-primary);
}
[data-ant-ui] .dagNodeHead{
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9.5px;
  font-weight: 700;
}
[data-ant-ui] .dagNodeDot{
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 1.5px;
  background: var(--dsw-alias-border-l3);
}
[data-ant-ui] .dagNode[data-state='running'] .dagNodeDot{
  background: var(--dsw-alias-state-business-primary);
}
[data-ant-ui] .dagNode[data-state='running'] .dagNodeHead{
  padding-right: 12px;
}
[data-ant-ui] .dagRunningState{
  position: absolute;
  top: 4px;
  right: 5px;
  display: inline-flex;
  width: 9px;
  height: 9px;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-state-business-primary);
  pointer-events: none;
}
[data-ant-ui] .dagRunningState .workGlyph{
  width: 9px;
  height: 9px;
}
[data-ant-ui] .dagNode[data-state='blocked'] .dagNodeDot{
  background: var(--dsw-alias-state-warn-primary);
}
[data-ant-ui] .dagNode[data-state='completed'] .dagNodeDot{
  background: var(--dsw-alias-state-success-primary);
}
[data-ant-ui] .dagNode[data-state='failed'] .dagNodeDot{
  background: var(--dsw-alias-state-error-primary);
}
[data-ant-ui] .dagNodeLabel{
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 8.5px;
  line-height: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .taskDetail{
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 9px;
  background: var(--dsw-alias-bg-module-platform);
}
[data-ant-ui] .taskDetailHead{
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
[data-ant-ui] .taskDetailId{
  flex: none;
  color: var(--dsw-alias-state-business-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
}
[data-ant-ui] .taskDetailSubject{
  overflow: hidden;
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .taskDetailBadge{
  flex: none;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--dsw-alias-button-ghost-active-fill);
  color: var(--dsw-alias-label-secondary);
  font-size: 8.5px;
  font-weight: 600;
  line-height: 14px;
}
[data-ant-ui] .taskDetailBadge[data-state='running']{
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary-inverted);
}
[data-ant-ui] .taskDetailBadge[data-state='blocked']{
  background: var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-label-primary-inverted);
}
[data-ant-ui] .taskDetailBadge[data-state='completed']{
  background: var(--dsw-alias-state-success-primary);
  color: var(--dsw-alias-label-primary-inverted);
}
[data-ant-ui] .taskDetailBadge[data-state='failed']{
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-inverted);
}
[data-ant-ui] .taskDetailLine,[data-ant-ui] .taskDetailMeta{
  color: var(--dsw-alias-label-secondary);
  font-size: 9.5px;
  line-height: 14px;
}
[data-ant-ui] .taskDetailMeta{
  color: var(--dsw-alias-label-tertiary);
}
[data-ant-ui] .emptyHint{
  padding: 10px 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
}
[data-ant-ui] .planEditor{
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 10px 12px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 30%, var(--dsw-alias-border-l2));
  border-radius: 10px;
  background: color-mix(in srgb, var(--dsw-alias-bg-module-platform) 94%, var(--dsw-alias-state-business-primary));
  box-shadow: inset 0 1px 0 color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent);
}
[data-ant-ui] .planHeader > span{
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
[data-ant-ui] .planHeader > span > span{
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}
[data-ant-ui] .planHeader strong{
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
}
[data-ant-ui] .planHeader small{
  color: var(--dsw-alias-label-secondary);
  font-size: 9px;
  font-weight: 500;
  line-height: 13px;
}
[data-ant-ui] .planHeader em{
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary-inverted);
  font-size: 9px;
  font-style: normal;
  line-height: 16px;
}
[data-ant-ui] .planHeader p{
  margin: 5px 0 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  line-height: 15px;
}
[data-ant-ui] .planFlow{
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
}
[data-ant-ui] .planFlow li{
  position: relative;
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
}
[data-ant-ui] .planFlow li:not(:last-child)::after{
  height: 1px;
  min-width: 8px;
  flex: 1;
  margin-right: 5px;
  background: var(--dsw-alias-border-l2);
  content: '';
}
[data-ant-ui] .planFlow li > span{
  display: grid;
  width: 18px;
  height: 18px;
  flex: none;
  place-items: center;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 50%;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9px;
}
[data-ant-ui] .planFlow li[data-active]{
  color: var(--dsw-alias-state-business-primary);
}
[data-ant-ui] .planFlow li[data-active] > span{
  border-color: var(--dsw-alias-state-business-primary);
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);
}
[data-ant-ui] .planSection{
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform);
}
[data-ant-ui] .planSectionToggle,[data-ant-ui] .planCardHeader{
  box-sizing: border-box;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  text-align: left;
}
[data-ant-ui] .planSectionToggle{
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 9px;
}
[data-ant-ui] .planSectionToggle:hover,[data-ant-ui] .planCardHeader:hover{
  background: color-mix(in srgb, var(--dsw-alias-button-ghost-active-fill) 46%, transparent);
}
[data-ant-ui] .planSectionToggle > span{
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
}
[data-ant-ui] .planSectionToggle strong{
  font-size: 10.5px;
}
[data-ant-ui] .planSectionToggle small{
  color: var(--dsw-alias-label-tertiary);
  font-size: 9px;
}
[data-ant-ui] .planList{
  display: flex;
  flex-direction: column;
  gap: 0;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
[data-ant-ui] .planEmpty{
  margin: 0;
  padding: 12px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  text-align: center;
}
[data-ant-ui] .planCard{
  position: relative;
  display: block;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
[data-ant-ui] .planCard + .planCard{
  border-top: 1px solid var(--dsw-alias-border-l2);
}
[data-ant-ui] .planCard[data-open='true']{
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent);
}
[data-ant-ui] .planCardHeader{
  display: grid;
  min-height: 40px;
  grid-template-columns: minmax(80px, 0.9fr) minmax(72px, 1.15fr) auto 12px;
  align-items: center;
  gap: 7px;
  padding: 6px 9px;
}
[data-ant-ui] .planCardIdentity{
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}
[data-ant-ui] .planCardIdentity strong,[data-ant-ui] .planTaskSummary{
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-size: 10px;
  font-weight: 650;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .planCardIdentity > span,[data-ant-ui] .planCardMeta{
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 8.5px;
  line-height: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .planTaskId{
  width: max-content;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--dsw-alias-button-ghost-active-fill);
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 8.5px;
  font-weight: 700;
  line-height: 14px;
}
[data-ant-ui] .planDirty{
  justify-self: end;
  padding: 1px 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 13%, transparent);
  color: var(--dsw-alias-state-warn-primary);
  font-size: 8px;
  font-style: normal;
  font-weight: 650;
  line-height: 14px;
}
[data-ant-ui] .planChevron{
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 180ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
[data-ant-ui] .planChevron[data-open='true']{
  transform: rotate(90deg);
}
[data-ant-ui] .planCardBody{
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 9px 9px;
}
[data-ant-ui] .planCardBody fieldset{
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  margin: 0;
  padding: 0;
  border: 0;
}
[data-ant-ui] .planCardBody label,[data-ant-ui] .planNewTask label{
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 9px;
}
[data-ant-ui] .planCardBody label small{
  color: var(--dsw-alias-label-tertiary);
  font-size: 8px;
  line-height: 11px;
}
[data-ant-ui] .planCard input,[data-ant-ui] .planCard textarea,[data-ant-ui] .planCard select,[data-ant-ui] .planNewTask input{
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  outline: none;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 10.5px;
  line-height: 16px;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}
[data-ant-ui] .planCard input,[data-ant-ui] .planCard select,[data-ant-ui] .planNewTask input{
  min-height: 32px;
  padding: 6px 8px;
}
[data-ant-ui] .planCard textarea{
  min-height: 58px;
  padding: 7px 8px;
  resize: vertical;
}
[data-ant-ui] .planCard input:focus-visible,[data-ant-ui] .planCard textarea:focus-visible,[data-ant-ui] .planCard select:focus-visible,[data-ant-ui] .planNewTask input:focus-visible{
  border-color: var(--dsw-alias-state-business-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);
}
[data-ant-ui] .planGrid{
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
}
[data-ant-ui] .planModelPicker{
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 5px;
}
[data-ant-ui] .planModelMenu{
  display: flex;
  width: 100%;
}
[data-ant-ui] .planModelTrigger{
  display: flex;
  width: 100%;
  min-height: 38px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  text-align: left;
  transition: border-color 160ms ease, background-color 160ms ease, transform 120ms ease;
}
[data-ant-ui] .planModelTrigger:hover:not(:disabled){
  border-color: var(--dsw-alias-border-l3);
  background: var(--dsw-alias-interactive-bg-hover);
}
[data-ant-ui] .planModelTrigger:active:not(:disabled){
  transform: translateY(1px);
}
[data-ant-ui] .planModelTrigger:focus-visible{
  border-color: var(--dsw-alias-state-business-primary);
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);
  outline-offset: 1px;
}
[data-ant-ui] .planModelTrigger:disabled{
  cursor: wait;
  opacity: 0.64;
}
[data-ant-ui] .planModelTriggerCopy{
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 6px;
}
[data-ant-ui] .planModelTriggerCopy strong,[data-ant-ui] .planModelTriggerCopy span{
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .planModelTriggerCopy strong{
  color: var(--dsw-alias-label-primary);
  font-size: 10px;
  font-weight: 650;
  line-height: 15px;
}
[data-ant-ui] .planModelTriggerCopy span{
  color: var(--dsw-alias-label-tertiary);
  font-size: 9px;
  line-height: 14px;
}
[data-ant-ui] .planModelMenuRow{
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
}
[data-ant-ui] .planModelMenuRow > span:first-child{
  color: var(--dsw-alias-label-primary);
}
[data-ant-ui] .planModelMenuRow strong{
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-weight: 450;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .planModelMenuBack{
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
[data-ant-ui] .planModelMenuBack svg{
  transform: rotate(180deg);
}
[data-ant-ui] .planModelEffortRow{
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
}
[data-ant-ui] .planModelEffortRow small{
  overflow: hidden;
  width: 100%;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .planModelHint{
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 8.5px;
  line-height: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .planModelNotice{
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 9%, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 8.5px;
  line-height: 12px;
}
[data-ant-ui] .planModelNotice button{
  flex: none;
  padding: 2px 6px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
  font: inherit;
  font-weight: 650;
}
[data-ant-ui] .planActions,[data-ant-ui] .planApproveRow,[data-ant-ui] .planNewTask,[data-ant-ui] .planConfirm,[data-ant-ui] .planApproveActions,[data-ant-ui] .planSecondaryActions{
  display: flex;
  align-items: center;
  gap: 7px;
}
[data-ant-ui] .planReviewActions{
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
}
[data-ant-ui] .planSecondaryActions{
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
}
[data-ant-ui] .planActions{
  justify-content: flex-end;
}
[data-ant-ui] .planActions button,[data-ant-ui] .planNewTask button,[data-ant-ui] .planApproveRow button,[data-ant-ui] .planConfirm button{
  flex: none;
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-button-ghost-active-fill);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font-size: 9.5px;
  font-weight: 600;
  transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
}
[data-ant-ui] .planActions button:hover:not(:disabled),[data-ant-ui] .planNewTask button:hover:not(:disabled),[data-ant-ui] .planApproveRow button:hover:not(:disabled),[data-ant-ui] .planConfirm button:hover:not(:disabled){
  border-color: var(--dsw-alias-label-tertiary);
}
[data-ant-ui] .planActions button:active:not(:disabled),[data-ant-ui] .planNewTask button:active:not(:disabled),[data-ant-ui] .planApproveRow button:active:not(:disabled),[data-ant-ui] .planConfirm button:active:not(:disabled){
  transform: scale(0.98);
}
[data-ant-ui] .planActions button[data-danger],[data-ant-ui] .planConfirm button[data-danger]{
  color: var(--dsw-alias-state-error-primary);
}
[data-ant-ui] .planFeedback{
  display: inline-flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 5px;
  color: var(--dsw-alias-label-secondary);
  font-size: 9px;
  line-height: 13px;
  animation: plan-feedback-in 180ms ease-out;
}
[data-ant-ui] .planFeedback[data-tone='success']{
  color: var(--dsw-alias-state-success-primary);
}
[data-ant-ui] .planFeedback[data-tone='error']{
  color: var(--dsw-alias-state-error-primary);
}
[data-ant-ui] .planFeedback > span{
  display: grid;
  width: 15px;
  height: 15px;
  flex: none;
  place-items: center;
  border: 1px solid currentColor;
  border-radius: 50%;
}
[data-ant-ui] .planFeedback svg{
  width: 11px;
  height: 11px;
}
@keyframes plan-feedback-in {
  from { opacity: 0; transform: translateY(-2px); }
[data-ant-ui] to{ opacity: 1; transform: translateY(0); }
[data-ant-ui] .planConfirm{
  flex-wrap: wrap;
  justify-content: flex-end;
  padding: 7px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, var(--dsw-alias-border-l2));
  border-radius: 7px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, transparent);
}
[data-ant-ui] .planConfirm > span{
  min-width: 140px;
  flex: 1;
  color: var(--dsw-alias-label-secondary);
  font-size: 9px;
  line-height: 13px;
}
[data-ant-ui] .planNewTask{
  align-items: flex-end;
}
[data-ant-ui] .planNewTask label{
  gap: 4px;
}
[data-ant-ui] .planNewTask label > span{
  line-height: 13px;
}
[data-ant-ui] .planApproveRow{
  position: sticky;
  z-index: 1;
  bottom: 0;
  min-height: 50px;
  align-items: stretch;
  flex-direction: column;
  justify-content: flex-end;
  margin: 0 -4px -4px;
  padding: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: color-mix(in srgb, var(--dsw-alias-bg-module-platform) 94%, transparent);
  box-shadow: 0 -5px 16px color-mix(in srgb, var(--dsw-alias-bg-base) 35%, transparent);
  backdrop-filter: blur(8px);
}
[data-ant-ui] .planApproveRow[data-armed='true']{
  border-color: color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, var(--dsw-alias-border-l2));
}
[data-ant-ui] .planApproveRow[data-discard='true']{
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2));
}
[data-ant-ui] .planApproveCopy{
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
[data-ant-ui] .planApproveCopy strong{
  color: var(--dsw-alias-label-primary);
  font-size: 9.5px;
  line-height: 13px;
}
[data-ant-ui] .planApproveCopy small{
  color: var(--dsw-alias-label-tertiary);
  font-size: 8.5px;
  line-height: 12px;
}
[data-ant-ui] .planApproveRow button{
  min-height: 32px;
  padding-inline: 13px;
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary-inverted);
}
[data-ant-ui] .planReviewActions > button[data-plan-approve]{
  width: 100%;
}
[data-ant-ui] .planApproveActions > button:first-child{
  background: var(--dsw-alias-button-ghost-active-fill);
  color: var(--dsw-alias-label-primary);
}
[data-ant-ui] .planSecondaryActions > button,[data-ant-ui] .planApproveActions > button[data-danger]{
  border-color: var(--dsw-alias-border-l2);
  background: var(--dsw-alias-button-ghost-active-fill);
  color: var(--dsw-alias-label-primary);
}
[data-ant-ui] .planSecondaryActions > button[data-danger],[data-ant-ui] .planApproveActions > button[data-danger]{
  color: var(--dsw-alias-state-error-primary);
}
[data-ant-ui] .planSectionToggle:focus-visible,[data-ant-ui] .planCardHeader:focus-visible,[data-ant-ui] .planActions button:focus-visible,[data-ant-ui] .planNewTask button:focus-visible,[data-ant-ui] .planApproveRow button:focus-visible,[data-ant-ui] .planConfirm button:focus-visible{
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}
[data-ant-ui] .planActions button:disabled,[data-ant-ui] .planNewTask button:disabled,[data-ant-ui] .planApproveRow button:disabled{
  cursor: default;
  opacity: 0.55;
}
[data-ant-ui] .historicPill{
  flex: none;
  margin-left: auto;
  padding: 1px 7px;
  border-radius: 4px;
  background: var(--dsw-alias-button-ghost-active-fill);
  color: var(--dsw-alias-label-tertiary);
  font-size: 9.5px;
  font-weight: 600;
  line-height: 15px;
}
[data-ant-ui] .members{
  display: flex;
  flex-direction: column;
  gap: 3px;
}
[data-ant-ui] .archiveLabel{
  display: block;
  padding: 5px 14px 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 9.5px;
  font-weight: 600;
  line-height: 14px;
}
@media (prefers-reduced-motion: reduce) {
  .panel,
  .badge,
  .badgeDot,
  .panelDot,
  .workGlyph rect,
  .stateArt,
  .memberAvatar[data-unread='true']::after {
    animation: none;
    transition: none;
  }
[data-ant-ui] .planChevron,[data-ant-ui] .planFeedback,[data-ant-ui] .planActions button,[data-ant-ui] .planNewTask button,[data-ant-ui] .planApproveRow button,[data-ant-ui] .planConfirm button,[data-ant-ui] .planCard input,[data-ant-ui] .planCard textarea,[data-ant-ui] .planCard select,[data-ant-ui] .planNewTask input{
    animation: none;
    transition: none;
  }
@media (max-width: 960px) {
  
}
@media (max-width: 640px) {
  .badge {
    top: 56px;
    right: 10px;
  }
[data-ant-ui] .teamStats span[data-stat='messages']{
    display: none;
  }
[data-ant-ui] .captainNode{
    grid-template-columns: 48px minmax(0, 1fr);
  }
[data-ant-ui] .captainState{
    display: none;
  }
[data-ant-ui] .delegationTree{
    margin-left: 12px;
    padding-left: 15px;
  }
[data-ant-ui] .memberBranch{
    width: 15px;
  }
[data-ant-ui] .assignmentLine{
    padding-left: 53px;
  }
[data-ant-ui] .planFlow li{
    gap: 4px;
    font-size: 8px;
  }
[data-ant-ui] .planFlow li:not(:last-child)::after{
    margin-right: 3px;
  }
[data-ant-ui] .planCardHeader{
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
[data-ant-ui] .planCardHeader .planCardMeta{
    display: none;
  }
[data-ant-ui] .planGrid{
    grid-template-columns: minmax(0, 1fr);
  }
[data-ant-ui] .planModelPicker{
    grid-template-columns: minmax(0, 1fr);
  }
[data-ant-ui] .planNewTask,[data-ant-ui] .planApproveRow{
    align-items: stretch;
    flex-direction: column;
  }
[data-ant-ui] .planNewTask button,[data-ant-ui] .planApproveRow > button,[data-ant-ui] .planApproveActions,[data-ant-ui] .planReviewActions{
    width: 100%;
  }
[data-ant-ui] .planApproveActions button,[data-ant-ui] .planReviewActions button,[data-ant-ui] .planSecondaryActions button{
    flex: 1;
  }
[data-ant-ui] @container agent-team (max-width: 360px){
  .planEditor {
    margin-inline: 0;
    padding-inline: 10px;
  }
[data-ant-ui] .planHeader > span{
    align-items: flex-start;
  }
[data-ant-ui] .planFlow li{
    gap: 3px;
    font-size: 7.5px;
  }
[data-ant-ui] .planFlow li:not(:last-child)::after{
    min-width: 4px;
    margin-right: 2px;
  }
[data-ant-ui] .planSecondaryActions,[data-ant-ui] .planApproveActions{
    display: grid;
    width: 100%;
    grid-template-columns: minmax(0, 1fr);
  }
[data-ant-ui] .planSecondaryActions button,[data-ant-ui] .planApproveActions button{
    width: 100%;
  }
[data-ant-ui] .dagOwner{ margin-left: auto; max-width: 64px; overflow: hidden; text-overflow: ellipsis; font-size: 9px; font-weight: 400; }
[data-ant-ui] .team[data-workspace-team]{ container-type: normal; container-name: none; padding: 0; border: 0; background: transparent; }
[data-ant-ui] .team[data-workspace-team] .teamHead{ flex-wrap: wrap; gap: 8px; padding-bottom: 18px; }
[data-ant-ui] .team[data-workspace-team] .teamName{ font-size: 15px; }
[data-ant-ui] .team[data-workspace-team] .teamStats{ flex-wrap: wrap; }
[data-ant-ui] .team[data-workspace-team] .delegationSection{ min-width: 0; }
[data-ant-ui] .team[data-workspace-team] .dependencySection{ min-width: 0; }
[data-ant-ui] .team[data-workspace-team] .dagNodeLabel{ white-space: normal; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.4; }
[data-ant-ui] .team[data-workspace-team] .sectionHead{ flex-wrap: wrap; gap: 6px; }
[data-ant-ui] .team[data-workspace-team] .sectionHint{ white-space: normal; }
[data-ant-ui] .team[data-workspace-team] .memberLine{ flex-wrap: wrap; }
[data-ant-ui] .team[data-workspace-team] .memberStatusLine{ white-space: normal; }
[data-ant-ui] .team[data-workspace-team] .taskDetailSubject{ white-space: normal; }
[data-ant-ui] .team[data-workspace-team] .dagViewport{ padding-bottom: 12px; }
[data-ant-ui] @container (min-width: 1000px){
  .team[data-workspace-team] { display: grid; grid-template-columns: minmax(260px, .85fr) minmax(0, 1.35fr); column-gap: 32px; align-items: start; }
[data-ant-ui] .team[data-workspace-team] > .teamHead{ grid-column: 1 / -1; }
[data-ant-ui] .team[data-workspace-team] > :not(.teamHead):not(.delegationSection):not(.dependencySection){ grid-column: 1 / -1; }
[data-ant-ui] .team[data-workspace-team] .dependencySection{ margin: 0; border-top: 0; border-left: 1px solid var(--dsw-alias-border-l2); padding: 0 0 0 28px; }
[data-ant-ui] .team[data-workspace-team] .captainNode{ padding-top: 0; }
[data-ant-ui] .team[data-workspace-team] .dagCanvas[data-layout='parallel']{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
[data-ant-ui] .team[data-workspace-team] .dagNode{ padding: 10px 11px; border-radius: 9px; }
[data-ant-ui] .team[data-workspace-team] .dagNodeHead{ font-size: 10px; margin-bottom: 7px; }
[data-ant-ui] .team[data-workspace-team] .dagNodeLabel{ font-size: 12px; letter-spacing: 0; }
[data-ant-ui] .team[data-workspace-team] .dagOwner{ font-size: 10px; }
[data-ant-ui] .team[data-workspace-team] .taskDetail{ margin-top: 14px; padding: 14px; }
[data-ant-ui] .team[data-workspace-team] .captainName{ font-size: 14px; }
[data-ant-ui] .team[data-workspace-team] .captainRole{ font-size: 11px; }
[data-ant-ui] .team[data-workspace-team] .captainSummary{ font-size: 12px; line-height: 1.6; }
[data-ant-ui] .team[data-workspace-team] .captainState{ font-size: 11px; }
[data-ant-ui] .team[data-workspace-team] .memberName{ font-size: 13px; }
[data-ant-ui] .team[data-workspace-team] .memberRole,[data-ant-ui] .team[data-workspace-team] .memberState,[data-ant-ui] .team[data-workspace-team] .memberCount{ font-size: 11px; }
[data-ant-ui] .team[data-workspace-team] .memberStatusLine{ font-size: 12px; line-height: 1.6; }
[data-ant-ui] .team[data-workspace-team] .taskDetailSubject{ font-size: 13px; line-height: 1.6; }
[data-ant-ui] .team[data-workspace-team] .taskDetailLine,[data-ant-ui] .team[data-workspace-team] .taskDetailMeta{ font-size: 12px; line-height: 1.6; }
[data-ant-ui] .team[data-workspace-team] .captainNode{ background: var(--dsw-alias-bg-module-platform); border-color: var(--dsw-alias-border-l2); }
[data-ant-ui] .team[data-workspace-team] .planEditor{ background: transparent; border-color: var(--dsw-alias-border-l2); padding: 16px; margin: 0 0 24px; }
[data-ant-ui] @container (min-width: 1000px){
  .team[data-workspace-team]:has(> [data-staging-editor]) { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
[data-ant-ui] .team[data-workspace-team] > [data-staging-editor]{ grid-column: 1 !important; grid-row: 2 / 4; }
[data-ant-ui] .team[data-workspace-team]:has(> [data-staging-editor]) > .delegationSection{ grid-column: 2; grid-row: 2; }
[data-ant-ui] .team[data-workspace-team]:has(> [data-staging-editor]) > .dependencySection{ grid-column: 2; grid-row: 3; border-left: 0; padding: 24px 0 0; }
[data-ant-ui] .team[data-workspace-team] .memberBlock[data-selected-member] .memberRow{ outline: 1px solid var(--dsw-alias-state-business-primary); outline-offset: 3px; }
[data-ant-ui] .team[data-workspace-team] .dagOwner{ white-space: nowrap; max-width: 105px; }
[data-ant-ui] .team[data-workspace-team] .planApproveRow{ position: static; }
[data-ant-ui] .root{
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 10px 12px;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-module-platform);
}
[data-ant-ui] .head{
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
[data-ant-ui] .leadAvatar{
  flex: none;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 0;
  object-fit: contain;
  background: transparent;
  filter: drop-shadow(0 1px 1px rgb(18 45 72 / 20%));
}
[data-ant-ui] .teamName{
  overflow: hidden;
  flex: 0 1 auto;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .memberCount{
  flex: none;
  margin-left: auto;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}
[data-ant-ui] .panelButton{
  flex: none;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 10.5px;
  font-weight: 600;
  line-height: 16px;
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease;
}
[data-ant-ui] .panelButton:hover{
  border-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-state-business-primary);
}
[data-ant-ui] .panelButton:focus-visible{
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
[data-ant-ui] .members{
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
[data-ant-ui] .member{
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 160px;
  padding: 3px 8px 3px 3px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  cursor: pointer;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}
[data-ant-ui] .member:hover{
  border-color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-button-ghost-active-fill);
}
[data-ant-ui] .member:focus-visible{
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
[data-ant-ui] .memberArt{
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 0;
  object-fit: contain;
  background: transparent;
  filter: drop-shadow(0 1px 1px rgb(18 45 72 / 18%));
}
[data-ant-ui] .memberInitial{
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary-inverted);
  font-size: 10px;
  font-weight: 600;
  line-height: 20px;
}
[data-ant-ui] .memberName{
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-ant-ui] .chatEntry{ display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; color: var(--dsw-alias-label-secondary); background: transparent; font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
[data-ant-ui] .chatEntry img{ width: 22px; height: 22px; object-fit: contain; }
[data-ant-ui] .chatEntry:hover{ background: var(--dsw-alias-bg-module-platform); }
[data-ant-ui] .chatEntry:focus-visible{ outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
[data-ant-ui] .turnCards{ display: grid; gap: 8px; margin-block: 10px; }
@media (max-width: 600px) { .head { flex-wrap: wrap; }
[data-ant-ui] .root{
  container: team-workspace / inline-size;
  height: 100%;
  min-height: 0;
  overflow: auto;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  font-family: inherit;
}
[data-ant-ui] .content{ max-width: 1400px; margin: 0 auto; padding: 12px 20px 28px; }
[data-ant-ui] .selector{ display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 24px; }
[data-ant-ui] .selector button{ display: flex; gap: 12px; align-items: center; max-width: 100%; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 8px 10px; text-align: left; overflow-wrap: anywhere; }
[data-ant-ui] .selector span{ font-size: 10px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
[data-ant-ui] .selector button[aria-pressed='true']{ background: var(--dsw-alias-bg-module-platform); border-color: var(--dsw-alias-label-tertiary); }
[data-ant-ui] .root button{ font-family: inherit; color: inherit; cursor: pointer; }
[data-ant-ui] .root button:active{ transform: scale(.98); }
[data-ant-ui] .root button:focus-visible{ outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: 3px; }
[data-ant-ui] .empty{ padding: 36px 0; max-width: 42ch; }
[data-ant-ui] .emptyMark{ font-size: 32px; color: var(--dsw-alias-label-tertiary); }
[data-ant-ui] .empty h3{ font-size: 16px; font-weight: 550; margin: 16px 0 10px; }
[data-ant-ui] .empty p{ color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.8; }
[data-ant-ui] .empty button,[data-ant-ui] .error button{ background: var(--dsw-alias-bg-module-platform); border: 1px solid var(--dsw-alias-border-l2); padding: 8px 12px; border-radius: 8px; font-size: 12px; }
[data-ant-ui] .error{ display: flex; align-items: start; gap: 12px; padding: 12px; margin-bottom: 20px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; font-size: 12px; line-height: 1.65; }
[data-ant-ui] .error button{ flex: none; }
[data-ant-ui] .skeleton{ display: grid; gap: 16px; padding-top: 20px; }
[data-ant-ui] .skeleton i{ height: 66px; border-radius: 8px; background: var(--dsw-alias-bg-module-platform); animation: breathe 1.8s ease-in-out infinite alternate; }
[data-ant-ui] .skeleton i:first-child{ width: 70%; height: 36px; }
[data-ant-ui] .skeleton i:last-child{ animation-delay: .3s; }
@keyframes breathe { to { opacity: .45; }
[data-ant-ui] @container (min-width: 720px){
  .content { padding: 20px 28px 32px; }
@media (prefers-reduced-motion: reduce) { .skeleton i { animation: none; }`;

const CUSTOM_CSS = `[data-ant-ui] .planInput,[data-ant-ui] .planTextarea{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:4px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px}
[data-ant-ui] .planTextarea{min-height:52px;resize:vertical}
[data-ant-ui] .planModelPick{text-align:left}

[data-ant-ui] .chatEntry{padding:0 8px 0 6px;height:26px}
[data-ant-ui] .chatEntry svg{display:block;flex:none;color:var(--dsw-alias-state-business-primary)}
[data-ant-ui] .chatEntryLabel{max-width:8em;overflow:hidden;text-overflow:ellipsis}
[data-ant-ui] .chatEntryCount{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-inverted);font-size:10px;font-weight:600;line-height:1}
[data-ant-ui] .panel{z-index:30}
[data-ant-ui] .resizeHandle[data-resize-edge='bottom']{left:12px;right:12px;bottom:0;height:6px;cursor:ns-resize}
[data-ant-ui] .resizeHandle[data-resize-edge='bottom'] .grip{display:block;width:28px;height:3px;margin:0 auto;border-radius:2px;background:var(--dsw-alias-border-l3);opacity:.7}
[data-ant-ui] .teams{padding-bottom:6px}
[data-ant-ui] .teams>.team{padding:0 12px}
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

    Object.assign(DICT.en, { error: 'Error', state: 'state', owner: 'owner', waiting: 'waiting', idle: 'idle', dispatching: 'working…', taskCount: 'tasks', refresh: 'Refresh', emptyHint: 'Open a conversation that belongs to a team, or seed one with the ant tools.' });
    Object.assign(DICT.zh, { error: '错误', state: '状态', owner: '归属', waiting: '等待', idle: '空闲', dispatching: '处理中…', taskCount: '任务', refresh: '刷新', emptyHint: '在属于某支团队的会话里打开，或用 ant 工具建一支。' });

    // ---------- panel vocabulary (upstream-shaped labels) ----------
    Object.assign(DICT.en, {
      seatLabel: 'Amber Ant', panelName: 'Amber Ant', close: 'Close', stopTeam: 'Stop team', stopTeamAsk: 'Stop every member of this team?',
      progress: 'Progress', progRunning: 'running', progBlocked: 'blocked', progDelivered: 'delivered',
      captain: 'Captain', captainRole: 'lead', delegationHint: 'delegation', membersHint: 'members',
      dependencies: 'Dependencies', depHint: 'click a node to trace its chain', dagHint: 'left to right by dependency depth',
      plan: 'Plan', planEmpty: 'This plan has no task yet.', confirmPlan: 'Confirm plan', releasing: 'Releasing',
      addTask: 'Add task', editTask: 'Edit task', save: 'Save', cancel: 'Cancel', title2: 'Title', objective2: 'Objective', acceptance2: 'Acceptance',
      archived: 'Archived', archivedPill: 'archived', stoppedPill: 'stopped', stagedPill: 'awaiting approval',
      emptyTeams: 'No team in this workspace', emptyTeamsHint: 'Create a team from the host tools, then reopen this panel.',
      unreadPill: 'unread', modelMenu: 'Pick a model', modelSearch: 'Search models', noModelMatch: 'No model matches',
      stopFailed: 'Stop failed', actionFailed: 'Action failed', releasingHint: 'Release the ready batch',
    });
    Object.assign(DICT.zh, {
      seatLabel: '玄驹', panelName: '玄驹', close: '关闭', stopTeam: '终止团队', stopTeamAsk: '终止这支团队的全部成员？',
      progress: '进度', progRunning: '运行', progBlocked: '受阻', progDelivered: '已交付',
      captain: '队长', captainRole: '统率', delegationHint: '协作', membersHint: '成员',
      dependencies: '依赖', depHint: '点击节点追溯链路', dagHint: '按依赖深度从左到右',
      plan: '计划', planEmpty: '计划里还没有任务。', confirmPlan: '确认计划', releasing: '放行中',
      addTask: '添加任务', editTask: '编辑任务', save: '保存', cancel: '取消', title2: '标题', objective2: '目标', acceptance2: '验收',
      archived: '已归档', archivedPill: '已归档', stoppedPill: '已终止', stagedPill: '待审批',
      emptyTeams: '这个工作区没有团队', emptyTeamsHint: '用宿主工具建队后再打开这个面板。',
      unreadPill: '未读', modelMenu: '选择模型', modelSearch: '搜索模型', noModelMatch: '没有匹配的模型',
      stopFailed: '终止失败', actionFailed: '操作失败', releasingHint: '放行就绪批次',
    });

    // ---------- team snapshot controller ----------
    function createController(remote) {
      let state = { status: 'loading', teams: [], views: {}, request: undefined, receipt: undefined, error: undefined };
      const listeners = new Set();
      let sequence = 0;
      let controller;
      let disposed = false;
      let bootstrapped = false;
      const emit = patch => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
      const nextSignal = () => { controller?.abort(); controller = new AbortController(); return controller.signal; };
      const readTeam = async (teamId, signal) => unwrapRemoteResult(await remote.get({ teamId }, signal));
      const loadAll = async () => {
        if (disposed) return;
        bootstrapped = true;
        const current = ++sequence;
        const signal = nextSignal();
        emit({ status: state.teams.length ? 'refreshing' : 'loading', error: undefined });
        try {
          const result = unwrapRemoteResult(await remote.list({ includeArchived: true, limit: 100 }, signal));
          if (disposed || current !== sequence) return;
          const teams = Array.isArray(result?.teams) ? result.teams : [];
          const settled = await Promise.all(teams.map(async item => {
            try { return [item.teamId, await readTeam(item.teamId, signal)]; } catch { return undefined; }
          }));
          if (disposed || current !== sequence) return;
          const views = {};
          for (const entry of settled) if (entry) views[entry[0]] = entry[1];
          emit({ teams, views, status: teams.length ? 'ready' : 'empty', error: undefined });
        } catch (error) {
          if (disposed || current !== sequence) return;
          const normalized = normalizeError(error);
          emit({ status: statusForError(normalized), error: normalized });
        }
      };
      const loadTeam = async teamId => {
        if (!teamId || disposed) return;
        try {
          const view = await readTeam(teamId, nextSignal());
          if (disposed) return;
          emit({ views: { ...state.views, [teamId]: view } });
        } catch (error) { if (!disposed) emit({ error: normalizeError(error) }); }
      };
      const dispatch = async (teamId, action, payload) => {
        if (!teamId || state.request || disposed) return;
        const request = { requestId: makeRequestId(), teamId, action, payload };
        emit({ request, receipt: undefined, error: undefined });
        try {
          const receipt = unwrapRemoteResult(await remote.dispatch(request, nextSignal()));
          if (disposed) return;
          emit({ request: undefined, receipt });
          await loadTeam(teamId);
        } catch (error) {
          if (disposed) return;
          const normalized = normalizeError(error);
          emit({ request: undefined, status: statusForError(normalized), error: normalized });
        }
      };
      return {
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        getSnapshot: () => state,
        loadAll,
        ensureLoaded() { if (disposed || bootstrapped) return undefined; return loadAll(); },
        loadTeam,
        dispatch,
        dispose() { disposed = true; sequence += 1; controller?.abort(); listeners.clear(); },
      };
    }

    // ---------- host view -> panel projection ----------
    const DONE_TASK_STATES = new Set(['released', 'reviewed']);
    const DROPPED_TASK_STATES = new Set(['dropped', 'superseded']);

    function routeOf(member) {
      const provider = (member?.provider ?? '').trim();
      const model = (member?.model ?? '').trim();
      if (provider !== '' && model !== '') return provider + '/' + model;
      return model !== '' ? model : provider;
    }

    function dependencyOf(view) {
      const map = new Map();
      const list = view?.plan?.dependencies;
      if (!Array.isArray(list)) return map;
      for (const dependency of list) {
        if (!dependency || !dependency.taskId || !dependency.blockedByTaskId) continue;
        const bucket = map.get(dependency.taskId) ?? [];
        bucket.push(dependency.blockedByTaskId);
        map.set(dependency.taskId, bucket);
      }
      return map;
    }

    function taskDepths(tasks, dependencies) {
      const known = new Set(tasks.map(task => task.id));
      const memo = new Map();
      const visiting = new Set();
      const depth = id => {
        if (memo.has(id)) return memo.get(id);
        if (visiting.has(id)) return 0;
        visiting.add(id);
        const parents = (dependencies.get(id) ?? []).filter(parent => known.has(parent));
        const value = parents.length === 0 ? 0 : Math.max(...parents.map(parent => depth(parent) + 1));
        visiting.delete(id);
        memo.set(id, value);
        return value;
      };
      for (const task of tasks) depth(task.id);
      return memo;
    }

    function toTeam(item, view) {
      const members = (view?.members ?? []).map(member => ({
        id: member.memberId,
        name: member.role ?? shortId(member.memberId),
        role: member.role ?? '',
        provider: member.provider ?? '',
        model: member.model ?? '',
        sessionId: member.sessionId,
        status: member.status ?? 'active',
        activity: 'idle',
      }));
      const byId = new Map(members.map(member => [member.id, member]));
      const dependencies = dependencyOf(view);
      const attempts = new Map();
      for (const attempt of view?.attempts ?? []) {
        const bucket = attempts.get(attempt.taskId) ?? [];
        bucket.push(attempt);
        attempts.set(attempt.taskId, bucket);
      }
      const declared = new Map((view?.tasks ?? []).map(task => [task.taskId, task]));
      const tasks = (view?.tasks ?? []).map(task => {
        const history = attempts.get(task.taskId) ?? [];
        const last = history[history.length - 1];
        const owner = byId.get(task.ownerMemberId ?? last?.memberId);
        const waitingOn = (dependencies.get(task.taskId) ?? []).filter(id => {
          const other = declared.get(id);
          return other !== undefined && !DONE_TASK_STATES.has(other.state) && !DROPPED_TASK_STATES.has(other.state);
        });
        let tone = 'ready';
        if (DONE_TASK_STATES.has(task.state)) tone = 'completed';
        else if (DROPPED_TASK_STATES.has(task.state)) tone = 'cancelled';
        else if (last?.state === 'running') { tone = 'running'; if (owner) owner.activity = 'working'; }
        else if (last?.state === 'paused' || last?.state === 'taken-over') { tone = 'blocked'; if (owner) owner.activity = 'working'; }
        else if (last?.state === 'terminated') tone = 'failed';
        else if (waitingOn.length > 0) tone = 'blocked';
        return {
          id: task.taskId,
          subject: task.title ?? task.taskId,
          objective: task.objective ?? '',
          acceptance: task.acceptance ?? [],
          state: tone,
          status: task.state,
          assignee: owner?.name ?? '',
          assigneeId: owner?.id,
          model: owner ? routeOf(owner) : '',
          dependencies: dependencies.get(task.taskId) ?? [],
          waitingOn,
        };
      });
      const depths = taskDepths(tasks, dependencies);
      for (const task of tasks) task.depth = depths.get(task.id) ?? 0;
      tasks.sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id, 'en', { numeric: true }));
      const lead = byId.get(view?.leadMemberId) ?? members[0];
      const goal = (view?.goal ?? item?.goal ?? '').trim();
      return {
        teamId: item?.teamId ?? view?.teamId,
        name: goal !== '' ? goal : (item?.teamId ?? ''),
        goal,
        phase: view?.planConfirmed === true ? 'running' : 'staged',
        halted: view?.halted === true,
        archived: (view?.lifecycle ?? item?.lifecycle) === 'archived',
        planConfirmed: view?.planConfirmed === true,
        planDigest: view?.planDigest,
        cursor: view?.cursor ?? item?.cursor ?? 0,
        leadName: lead?.name,
        captainSessionId: lead?.sessionId,
        members,
        tasks,
        total: tasks.length,
        done: tasks.filter(task => task.state === 'completed').length,
        messageCount: (view?.mailbox ?? []).length,
        view,
      };
    }

    // ---------- compact dependency DAG (upstream geometry) ----------
    const DAG_NODE_WIDTH = 92;
    const DAG_NODE_HEIGHT = 30;
    const DAG_COLUMN_GAP = 26;
    const DAG_ROW_GAP = 8;

    function dagLayout(tasks) {
      const stages = new Map();
      for (const task of tasks) {
        const depth = Number.isFinite(task.depth) ? Math.max(0, Math.floor(task.depth)) : 0;
        const bucket = stages.get(depth) ?? [];
        bucket.push(task);
        stages.set(depth, bucket);
      }
      const ordered = [...stages.entries()].sort((left, right) => left[0] - right[0]).map(entry => entry[1].slice().sort((left, right) => left.id.localeCompare(right.id, 'en', { numeric: true })));
      const positions = new Map();
      const nodes = [];
      ordered.forEach((stage, column) => {
        stage.forEach((task, row) => {
          const x = column * (DAG_NODE_WIDTH + DAG_COLUMN_GAP);
          const y = row * (DAG_NODE_HEIGHT + DAG_ROW_GAP);
          positions.set(task.id, { x, y });
          nodes.push({ task, x, y });
        });
      });
      const edges = [];
      for (const task of tasks) {
        const target = positions.get(task.id);
        if (target === undefined) continue;
        for (const dependency of task.dependencies) {
          const source = positions.get(dependency);
          if (source === undefined) continue;
          const x1 = source.x + DAG_NODE_WIDTH;
          const y1 = source.y + DAG_NODE_HEIGHT / 2;
          const x2 = target.x;
          const y2 = target.y + DAG_NODE_HEIGHT / 2;
          edges.push({ from: dependency, to: task.id, d: 'M' + x1 + ' ' + y1 + 'C' + (x1 + 14) + ' ' + y1 + ',' + (x2 - 14) + ' ' + y2 + ',' + x2 + ' ' + y2 });
        }
      }
      const rows = Math.max(1, ...ordered.map(stage => stage.length));
      return {
        width: ordered.length === 0 ? 0 : ordered.length * DAG_NODE_WIDTH + (ordered.length - 1) * DAG_COLUMN_GAP,
        height: ordered.length === 0 ? 0 : rows * DAG_NODE_HEIGHT + (rows - 1) * DAG_ROW_GAP,
        nodes,
        edges,
      };
    }

    function relatedTaskIds(taskId, tasks) {
      const byId = new Map(tasks.map(task => [task.id, task]));
      if (!byId.has(taskId)) return null;
      const dependents = new Map();
      for (const task of tasks) {
        for (const dependency of task.dependencies) {
          const bucket = dependents.get(dependency) ?? [];
          bucket.push(task.id);
          dependents.set(dependency, bucket);
        }
      }
      const related = new Set();
      const walkUp = (id, seen) => {
        if (seen.has(id)) return;
        seen.add(id);
        related.add(id);
        for (const parent of byId.get(id)?.dependencies ?? []) walkUp(parent, seen);
      };
      const walkDown = (id, seen) => {
        if (seen.has(id)) return;
        seen.add(id);
        related.add(id);
        for (const child of dependents.get(id) ?? []) walkDown(child, seen);
      };
      walkUp(taskId, new Set());
      walkDown(taskId, new Set());
      return related;
    }

    // ---------- atoms ----------
    function Chevron({ open }) {
      return h('svg', { className: 'chevron', 'data-open': open ? 'true' : 'false', width: 9, height: 9, viewBox: '0 0 10 10', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M3.5 2l3 3-3 3' }));
    }

    function WorkGlyph({ active }) {
      const cells = [[0, 0], [4.2, 0], [8.4, 0], [0, 4.2], [4.2, 4.2], [8.4, 4.2]];
      return h('svg', { className: 'workGlyph', 'data-active': active ? 'true' : 'false', width: 11, height: 11, viewBox: '0 0 11 11', fill: 'currentColor', 'aria-hidden': 'true' },
        cells.map((cell, index) => h('rect', { key: String(index), x: cell[0], y: cell[1], width: 2.6, height: 2.6, rx: 0.6, style: { animationDelay: (index * 0.15) + 's' } })));
    }

    function stateText(t, task) {
      if (task.state === 'completed') return t.t('progDelivered');
      if (task.state === 'running') return t.t('progRunning');
      if (task.state === 'blocked') return t.t('progBlocked');
      if (task.state === 'failed') return t.t('error');
      if (task.state === 'cancelled') return t.t('cancel');
      return t.t('state');
    }

    function ProgressOverview({ team, t }) {
      const running = team.tasks.filter(task => task.state === 'running').length;
      const blocked = team.tasks.filter(task => task.state === 'blocked').length;
      const completed = team.tasks.filter(task => task.state === 'completed').length;
      const settled = team.total > 0 && team.tasks.every(task => task.state === 'completed' || task.state === 'failed' || task.state === 'cancelled');
      const tone = blocked > 0 || team.tasks.some(task => task.state === 'failed') ? 'warning' : settled ? 'completed' : 'running';
      return h('section', { className: 'progressOverview', 'aria-label': t.t('progress'), 'data-progress-summary': '' },
        h('span', { className: 'progressTitle' }, t.t('progress')),
        team.total > 0
          ? h('span', { className: 'progressSegments', 'aria-hidden': 'true' }, team.tasks.map(task => h('span', { key: task.id, 'data-state': task.state })))
          : h('span', { className: 'progressEmpty' }),
        h('span', { className: 'progressLegend' },
          h('span', { 'data-state': 'running' }, t.t('progRunning') + ' ' + running),
          h('span', { 'data-state': 'blocked' }, t.t('progBlocked') + ' ' + blocked),
          h('span', { 'data-state': 'completed' }, t.t('progDelivered') + ' ' + completed)),
        h('span', { className: 'progressSummary', 'data-state': tone },
          h('span', { className: 'progressSummaryDot' }),
          h('span', null, team.done + '/' + team.total)));
    }

    function DependencyMap({ team, t, selectedId, onSelect }) {
      const [open, setOpen] = React.useState(true);
      const [pinned, setPinned] = React.useState(null);
      const [hovered, setHovered] = React.useState(null);
      const focusId = pinned ?? hovered ?? selectedId ?? null;
      const related = focusId === null ? null : relatedTaskIds(focusId, team.tasks);
      const layout = React.useMemo(() => dagLayout(team.tasks), [team.tasks]);
      if (team.tasks.length === 0) return null;
      const detail = team.tasks.find(task => task.id === focusId)
        ?? team.tasks.find(task => task.state === 'blocked')
        ?? team.tasks.find(task => task.state === 'running')
        ?? team.tasks[0];
      const dependents = team.tasks.filter(task => task.dependencies.indexOf(detail.id) >= 0);
      return h('section', { className: 'dependencySection', 'aria-label': t.t('dependencies'), 'data-dependency-map': '' },
        h('header', { className: 'sectionHead' },
          h('button', { type: 'button', className: 'sectionToggleTitle', 'aria-expanded': open ? 'true' : 'false', onClick: () => setOpen(value => !value) },
            h(Chevron, { open }),
            h('span', null, t.t('dependencies'))),
          h('span', { className: 'sectionHint' }, focusId === null ? t.t('dagHint') : detail.id)),
        open ? h('div', { className: 'dagViewport' },
          h('div', { className: 'dagCanvas', style: { width: layout.width, height: layout.height } },
            h('svg', { className: 'dagEdges', width: layout.width, height: layout.height, 'aria-hidden': 'true' },
              layout.edges.map(edge => h('path', {
                key: edge.from + '>' + edge.to,
                d: edge.d,
                'data-active': related !== null && related.has(edge.from) && related.has(edge.to) ? 'true' : undefined,
                'data-dimmed': related !== null && !(related.has(edge.from) && related.has(edge.to)) ? 'true' : undefined,
              }))),
            layout.nodes.map(node => h('button', {
              key: node.task.id,
              type: 'button',
              className: 'dagNode',
              'data-state': node.task.state,
              'data-focused': focusId === node.task.id ? 'true' : undefined,
              'data-dimmed': related !== null && !related.has(node.task.id) ? 'true' : undefined,
              style: { left: node.x, top: node.y, width: DAG_NODE_WIDTH, height: DAG_NODE_HEIGHT },
              title: node.task.id + ' · ' + node.task.subject,
              onClick: () => { const next = pinned === node.task.id ? null : node.task.id; setPinned(next); onSelect(next); },
              onMouseEnter: () => setHovered(node.task.id),
              onMouseLeave: () => setHovered(current => current === node.task.id ? null : current),
            },
              h('span', { className: 'dagNodeHead' }, h('span', { className: 'dagNodeDot' }), h('span', { className: 'dagNodeLabel' }, node.task.subject)),
              node.task.assignee !== '' ? h('span', { className: 'dagOwner' }, node.task.assignee) : null)))) : null,
        h('div', { className: 'taskDetail', 'data-task-detail': detail.id },
          h('div', { className: 'taskDetailHead' },
            h('span', { className: 'taskDetailId' }, detail.id),
            h('span', { className: 'taskDetailBadge', 'data-state': detail.state }, stateText(t, detail))),
          h('div', { className: 'taskDetailSubject' }, detail.subject),
          detail.objective !== '' ? h('div', { className: 'taskDetailLine' }, detail.objective) : null,
          h('div', { className: 'taskDetailMeta' },
            h('span', null, detail.assignee === '' ? t.t('owner') : detail.assignee),
            detail.model !== '' ? h('span', { className: 'taskDetailModel' }, detail.model) : null),
          detail.waitingOn.length > 0 ? h('div', { className: 'taskDetailLine' }, t.t('dependencies') + ': ' + detail.waitingOn.join(', ')) : null,
          dependents.length > 0 ? h('div', { className: 'taskDetailLine' }, dependents.map(task => task.id).join(', ')) : null));
    }

    Object.assign(DICT.en, { idle: 'idle', waiting: 'waiting', members: 'Members', taskCount: 'tasks' });
    Object.assign(DICT.zh, { idle: '空闲', waiting: '等待', members: '成员', taskCount: '任务' });

    function memberStatusText(t, member, tasks) {
      const owned = tasks.filter(task => task.assigneeId === member.id);
      if (member.activity === 'working') return t.t('progRunning');
      if (owned.some(task => task.state === 'failed')) return t.t('error');
      if (owned.some(task => task.state === 'blocked')) return t.t('progBlocked');
      if (owned.length > 0 && owned.every(task => task.state === 'completed')) return t.t('progDelivered');
      if (owned.length > 0) return t.t('waiting');
      return t.t('idle');
    }

    function ModelMenu({ t, ui, onPick }) {
      const [groups, setGroups] = React.useState(undefined);
      const [query, setQuery] = React.useState('');
      React.useEffect(() => {
        let live = true;
        (async () => {
          try {
            const directory = ui.catalog();
            if (!directory) throw new Error('no model directory');
            await directory.load();
            if (live) setGroups(directory.store.getSnapshot().groups ?? []);
          } catch (error) { trace('catalog-failed', error); if (live) setGroups([]); }
        })();
        return () => { live = false; };
      }, [ui]);
      const needle = query.trim().toLowerCase();
      const entries = [];
      for (const group of groups ?? []) {
        const provider = group.provider ?? group.id ?? '';
        const models = Array.isArray(group.models) ? group.models : [];
        const picked = models
          .map(item => (typeof item === 'string' ? { model: item } : item))
          .filter(item => needle === '' || String(item.model ?? item.id ?? '').toLowerCase().indexOf(needle) >= 0);
        if (picked.length > 0) entries.push({ provider, models: picked });
      }
      return h('div', { className: 'planModelMenu' },
        h('input', { className: 'planModelMenuRow', value: query, placeholder: t.t('modelSearch'), onChange: event => setQuery(event.target.value) }),
        groups !== undefined && entries.length === 0 ? h('div', { className: 'planModelHint' }, t.t('noModelMatch')) : null,
        entries.map(entry => h('div', { key: entry.provider },
          h('div', { className: 'stageLabel' }, entry.provider),
          entry.models.map(item => {
            const model = String(item.model ?? item.id ?? '');
            return h('button', { key: entry.provider + '/' + model, type: 'button', className: 'planModelMenuRow planModelPick', 'data-model-pick': entry.provider + '/' + model, onClick: () => onPick(entry.provider, model) }, model);
          }))));
    }

    function MemberTree({ team, t, ui, open, onToggle, menuMemberId, onMenu, onDispatch }) {
      const working = team.members.filter(member => member.activity === 'working');
      const visible = open ? team.members : working;
      return h('section', { className: 'delegationSection', 'aria-label': t.t('members') },
        h('button', { type: 'button', className: 'membersToggle', 'aria-expanded': open ? 'true' : 'false', onClick: onToggle },
          h(Chevron, { open }),
          h('span', null, t.t('members') + ' ' + team.members.length),
          h('span', null, open ? '' : working.length + '/' + team.members.length)),
        h('div', { className: 'delegationTree' }, visible.map(member => {
          const owned = team.tasks.filter(task => task.assigneeId === member.id);
          return h('div', { key: member.id, className: 'memberBlock' },
            h('div', { className: 'memberRow', 'data-activity': member.activity, role: 'group' },
              h('span', { className: 'memberAvatar' }, h(AntShape, { size: 14 })),
              h('span', { className: 'memberInfo' },
                h('span', { className: 'memberLine' },
                  h('span', { className: 'memberName' }, member.name),
                  h('span', { className: 'memberRole' }, team.leadName === member.name ? t.t('captainRole') : '')),
                h('span', { className: 'memberStatusLine' }, memberStatusText(t, member, team.tasks))),
              member.model !== '' || member.provider !== ''
                ? h('button', { type: 'button', className: 'memberModel', 'aria-expanded': menuMemberId === member.id ? 'true' : 'false', onClick: () => onMenu(menuMemberId === member.id ? null : member.id) }, routeOf(member))
                : null,
              h('span', { className: 'memberState', 'data-activity': member.activity }, member.activity === 'working' ? t.t('progRunning') : t.t('idle'))),
            menuMemberId === member.id
              ? h(ModelMenu, { t, ui, onPick: (provider, model) => { onMenu(null); onDispatch('member.changeModel', { memberId: member.id, provider, model }); } })
              : null,
            owned.length > 0
              ? h('div', { className: 'assignmentLine' }, owned.map(task => h('span', { key: task.id, className: 'assignmentChip', 'data-state': task.state }, task.id)))
              : null);
        })));
    }

    function PlanSection({ team, t, request, onDispatch }) {
      const [editor, setEditor] = React.useState(undefined);
      const confirmed = team.planConfirmed;
      const ready = team.tasks.filter(task => task.state !== 'completed' && task.state !== 'cancelled');
      const openEditor = (task) => setEditor(task === undefined
        ? { id: 'new', title: '', objective: '', acceptance: '' }
        : { id: task.id, title: task.subject, objective: task.objective, acceptance: (task.acceptance ?? []).join('；') });
      const save = () => {
        const title = editor.title.trim();
        const objective = editor.objective.trim();
        if (title === '' || objective === '') return;
        const acceptance = editor.acceptance.split(/[；;\n]/).map(item => item.trim()).filter(item => item !== '');
        setEditor(undefined);
        if (editor.id === 'new') {
          onDispatch('task.create', {
            task: { taskId: 'task-' + Date.now().toString(36), title, objective, inScope: [], outOfScope: [], acceptance, verify: [] },
            reason: 'added from the colony panel',
          });
        } else {
          onDispatch('task.amend', { taskId: editor.id, patch: { title, objective, acceptance }, reason: 'amended from the colony panel' });
        }
      };
      return h('section', { className: 'planSection', 'aria-label': t.t('plan') },
        h('header', { className: 'sectionHead' },
          h('span', { className: 'sectionTitle' }, t.t('plan')),
          h('span', { className: 'sectionHint' }, team.done + '/' + team.total)),
        team.total === 0 ? h('div', { className: 'planEmpty' }, t.t('planEmpty')) : null,
        h('div', { className: 'planGrid' }, team.tasks.map(task => h('div', { key: task.id, className: 'planCard', 'data-state': task.state },
          h('div', { className: 'planCardHeader' },
            h('button', { type: 'button', className: 'planCardIdentity', onClick: () => openEditor(task) },
              h('span', { className: 'planTaskId' }, task.id),
              h('span', { className: 'planTaskSummary' }, task.subject)),
            h('span', { className: 'stageLabel', 'data-state': task.state }, stateText(t, task))),
          editor !== undefined && editor.id === task.id
            ? h('div', { className: 'planEditor' },
              h('input', { className: 'planInput', value: editor.title, placeholder: t.t('title2'), onChange: event => setEditor({ ...editor, title: event.target.value }) }),
              h('textarea', { className: 'planTextarea', value: editor.objective, placeholder: t.t('objective2'), onChange: event => setEditor({ ...editor, objective: event.target.value }) }),
              h('input', { className: 'planInput', value: editor.acceptance, placeholder: t.t('acceptance2'), onChange: event => setEditor({ ...editor, acceptance: event.target.value }) }),
              h('div', { className: 'planApproveRow' },
                h('button', { type: 'button', onClick: save, disabled: editor.title.trim() === '' || editor.objective.trim() === '' }, t.t('save')),
                h('button', { type: 'button', onClick: () => setEditor(undefined) }, t.t('cancel'))))
            : null,
          task.assignee !== '' ? h('div', { className: 'planCardMeta' }, h('span', null, task.assignee), task.model !== '' ? h('span', null, task.model) : null) : null))),
        editor !== undefined && editor.id === 'new'
          ? h('div', { className: 'planEditor' },
            h('input', { className: 'planInput', value: editor.title, placeholder: t.t('title2'), onChange: event => setEditor({ ...editor, title: event.target.value }) }),
            h('textarea', { className: 'planTextarea', value: editor.objective, placeholder: t.t('objective2'), onChange: event => setEditor({ ...editor, objective: event.target.value }) }),
            h('input', { className: 'planInput', value: editor.acceptance, placeholder: t.t('acceptance2'), onChange: event => setEditor({ ...editor, acceptance: event.target.value }) }),
            h('div', { className: 'planApproveRow' },
              h('button', { type: 'button', onClick: save, disabled: editor.title.trim() === '' || editor.objective.trim() === '' }, t.t('save')),
              h('button', { type: 'button', onClick: () => setEditor(undefined) }, t.t('cancel'))))
          : null,
        h('div', { className: 'planApproveRow' },
          confirmed
            ? h('button', { type: 'button', disabled: ready.length === 0 || request === true, onClick: () => onDispatch('batch.release', { batchId: 'batch-' + (team.cursor + 1), taskIds: ready.map(task => task.id) }) }, t.t('releasing'))
            : h('button', { type: 'button', disabled: !team.planDigest || request === true, onClick: () => onDispatch('plan.confirm', { planDigest: team.planDigest }) }, t.t('confirmPlan')),
          confirmed ? h('button', { type: 'button', onClick: () => openEditor(undefined) }, t.t('addTask')) : null),
        request === true ? h('div', { className: 'planFeedback' }, t.t('dispatching')) : null);
    }

    function TeamSection({ team, t, ui, request, onDispatch, historic }) {
      const [membersOpen, setMembersOpen] = React.useState(!historic);
      const [selectedTaskId, setSelectedTaskId] = React.useState(null);
      const [menuMemberId, setMenuMemberId] = React.useState(null);
      const [stopArmed, setStopArmed] = React.useState(false);
      const busyCount = team.members.filter(member => member.activity === 'working').length;
      const canStop = !historic && !team.halted && team.phase === 'running';
      return h('section', { className: 'team', 'data-team-id': team.teamId, 'data-ant-team': team.teamId },
        h('header', { className: 'teamHead' },
          h('span', { className: 'teamName', title: team.goal !== '' ? team.goal : team.teamId }, team.name),
          team.archived ? h('span', { className: 'historicPill' }, t.t('archivedPill')) : null,
          team.halted ? h('span', { className: 'historicPill' }, t.t('stoppedPill')) : null,
          team.phase === 'staged' && !team.archived ? h('span', { className: 'historicPill' }, t.t('stagedPill')) : null,
          h('span', { className: 'teamStats' },
            h('span', { 'data-stat': 'members' }, t.t('members') + ' ' + team.members.length),
            h('span', { 'data-stat': 'tasks' }, team.done + '/' + team.total),
            h('span', { 'data-stat': 'messages' }, String(team.messageCount))),
          canStop ? h('button', { type: 'button', className: 'teamStopButton', 'aria-label': t.t('stopTeam'), title: t.t('stopTeam'), onClick: () => setStopArmed(value => !value) },
            h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'currentColor', 'aria-hidden': 'true' }, h('rect', { x: 2, y: 2, width: 8, height: 8, rx: 2 }))) : null),
        stopArmed ? h('div', { className: 'planApproveRow', 'data-armed': 'true' },
          h('button', { type: 'button', 'data-danger': 'true', onClick: () => { setStopArmed(false); onDispatch('team.halt', { reason: 'stopped from the colony panel' }); } }, t.t('stopTeam')),
          h('button', { type: 'button', onClick: () => setStopArmed(false) }, t.t('cancel'))) : null,
        h('div', { className: 'captainNode' },
          h('span', { className: 'captainAvatar' }, h(AntShape, { size: 16 })),
          h('span', { className: 'captainInfo' },
            h('span', { className: 'captainLine' },
              h('span', { className: 'captainName' }, team.leadName ?? t.t('captain')),
              h('span', { className: 'captainRole' }, t.t('captainRole'))),
            h('span', { className: 'captainSummary' }, t.t('members') + ' ' + team.members.length + ' · ' + t.t('taskCount') + ' ' + team.total)),
          h('span', { className: 'captainState', 'data-busy': busyCount > 0 ? 'true' : 'false' },
            h(WorkGlyph, { active: busyCount > 0 }),
            busyCount > 0 ? t.t('progRunning') + ' ' + busyCount : t.t('idle'))),
        h(ProgressOverview, { team, t }),
        h(MemberTree, { team, t, ui, open: membersOpen, onToggle: () => setMembersOpen(value => !value), menuMemberId, onMenu: setMenuMemberId, onDispatch }),
        h(DependencyMap, { team, t, selectedId: selectedTaskId, onSelect: setSelectedTaskId }),
        historic ? null : h(PlanSection, { team, t, request, onDispatch }));
    }


    const PANEL_STORAGE = 'ant:panel:v1';
    const PANEL_DEFAULT_WIDTH = 388;
    const PANEL_MIN_WIDTH = 320;
    const PANEL_MIN_HEIGHT = 360;

    function clampNumber(value, min, max) { return Math.min(Math.max(value, min), max); }

    function readGeometry() {
      try {
        const raw = window.localStorage.getItem(PANEL_STORAGE);
        if (!raw) return undefined;
        const value = JSON.parse(raw);
        if (!value || typeof value.x !== 'number' || typeof value.y !== 'number' || typeof value.width !== 'number' || typeof value.height !== 'number') return undefined;
        return { x: value.x, y: value.y, width: clampNumber(value.width, PANEL_MIN_WIDTH, 900), height: clampNumber(value.height, PANEL_MIN_HEIGHT, 1400) };
      } catch (error) { trace('geometry-read-failed', error); return undefined; }
    }

    function writeGeometry(geometry) {
      try { window.localStorage.setItem(PANEL_STORAGE, JSON.stringify(geometry)); } catch (error) { trace('geometry-write-failed', error); }
    }

    function beginPointer(event, onMove) {
      if (typeof document === 'undefined' || (event.button !== undefined && event.button !== 0)) return;
      const startX = event.clientX ?? 0;
      const startY = event.clientY ?? 0;
      const move = moveEvent => onMove((moveEvent.clientX ?? startX) - startX, (moveEvent.clientY ?? startY) - startY);
      const stop = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', stop);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', stop);
    }

    function RefreshIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M13 8a5 5 0 1 1-1.7-3.8' }),
        h('path', { d: 'M13 2.6v2.6h-2.6' }));
    }

    function CloseIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M4 4l8 8M12 4l-8 8' }));
    }

    function ColonyPanel({ model, locale, ui }) {
      const state = useModel(model);
      const t = useLocale(locale);
      const open = useShell(ui);
      const [geometry, setGeometry] = React.useState(readGeometry);
      React.useEffect(() => { if (open) model.loadAll(); }, [open, model]);
      React.useEffect(() => { if (geometry !== undefined) writeGeometry(geometry); }, [geometry]);
      React.useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined;
        const away = event => {
          const target = event.target;
          if (target && typeof target.closest === 'function' && (target.closest('[data-ant-panel]') || target.closest('[data-ant-seat]'))) return;
          ui.set(false);
        };
        const key = event => { if (event.key === 'Escape') ui.set(false); };
        document.addEventListener('mousedown', away);
        document.addEventListener('keydown', key);
        return () => {
          document.removeEventListener('mousedown', away);
          document.removeEventListener('keydown', key);
        };
      }, [open, ui]);
      if (!open) return null;
      const entries = (state.teams ?? []).map(item => ({ item, team: toTeam(item, state.views?.[item.teamId]) }));
      const live = entries.filter(entry => !entry.team.archived);
      const archived = entries.filter(entry => entry.team.archived);
      const base = () => {
        if (geometry !== undefined) return geometry;
        const width = typeof window === 'undefined' ? 1200 : (window.innerWidth || 1200);
        return { x: Math.max(12, width - PANEL_DEFAULT_WIDTH - 18), y: 64, width: PANEL_DEFAULT_WIDTH, height: 560 };
      };
      const onHeadDown = event => {
        const start = base();
        if (start === undefined) return;
        beginPointer(event, (dx, dy) => setGeometry({ x: Math.round(start.x + dx), y: Math.round(start.y + dy), width: start.width, height: start.height }));
      };
      const onGripDown = event => {
        const start = base();
        if (start === undefined) return;
        beginPointer(event, (dx, dy) => setGeometry({
          x: start.x,
          y: start.y,
          width: clampNumber(start.width + dx, PANEL_MIN_WIDTH, 900),
          height: clampNumber(start.height + dy, PANEL_MIN_HEIGHT, 1400),
        }));
      };
      const style = geometry === undefined
        ? { position: 'absolute', top: 64, left: 'auto', right: 18, width: PANEL_DEFAULT_WIDTH, maxHeight: 'calc(100% - 116px)' }
        : { position: 'fixed', top: geometry.y, left: geometry.x, right: 'auto', width: geometry.width, height: geometry.height, maxHeight: 'none' };
      const renderTeam = (entry, historic) => h(TeamSection, {
        key: entry.team.teamId,
        team: entry.team,
        t,
        ui,
        historic,
        request: state.request !== undefined && state.request.teamId === entry.team.teamId,
        onDispatch: (action, payload) => model.dispatch(entry.team.teamId, action, payload),
      });
      return h('div', {
        className: 'panel',
        'data-ant-ui': 'true',
        'data-ant-panel': 'true',
        style,
        role: 'dialog',
        'aria-label': t.t('seatLabel'),
      },
        h('div', { className: 'panelHead', onPointerDown: onHeadDown },
          h('span', { className: 'panelTitle' }, h(AntShape, { size: 14 }), t.t('seatLabel')),
          h('span', { className: 'panelControls' },
            h('button', { type: 'button', className: 'iconButton', title: t.t('refresh'), 'aria-label': t.t('refresh'), onClick: () => model.loadAll() }, h(RefreshIcon)),
            h('button', { type: 'button', className: 'iconButton', title: t.t('close'), 'aria-label': t.t('close'), onClick: () => ui.set(false) }, h(CloseIcon)))),
        h('div', { className: 'teams' },
          state.error !== undefined ? h('div', { className: 'error' }, h('span', null, state.error.message ?? String(state.error))) : null,
          entries.length === 0
            ? h('div', { className: 'empty' }, h('h3', null, t.t('emptyTeams')), h('p', null, t.t('emptyHint')))
            : null,
          live.map(entry => renderTeam(entry, false)),
          archived.length > 0 ? h('span', { key: 'archive-label', className: 'archiveLabel' }, t.t('archived')) : null,
          archived.map(entry => renderTeam(entry, true))),
        h('div', { className: 'resizeHandle', 'data-resize-edge': 'bottom', onPointerDown: onGripDown }, h('span', { className: 'grip' })));
    }

    function ColonySeat({ model, locale, ui, sessionId, catalog }) {
      const state = useModel(model);
      const t = useLocale(locale);
      const open = useShell(ui);
      if (typeof catalog === 'function') ui.setCatalog(catalog);
      React.useEffect(() => { model.ensureLoaded(); }, [model]);
      React.useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const focus = () => model.loadAll();
        window.addEventListener('focus', focus);
        return () => window.removeEventListener('focus', focus);
      }, [model]);
      const entries = (state.teams ?? []).map(item => toTeam(item, state.views?.[item.teamId]));
      const live = entries.filter(team => !team.archived);
      const busy = live.filter(team => team.tasks.some(task => task.state === 'running')).length;
      const label = live.length === 1 ? live[0].name : t.t('seatLabel');
      return h('span', { 'data-ant-ui': 'true', 'data-ant-seat': 'true' },
        h('button', {
          type: 'button',
          className: 'chatEntry',
          title: label,
          'aria-haspopup': 'dialog',
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => ui.toggle(),
        },
          h(AntShape, { size: 14 }),
          h('span', { className: 'chatEntryLabel' }, label),
          busy > 0 ? h('span', { className: 'chatEntryCount', 'data-busy': 'true' }, String(busy)) : null));
    }

    function installStyles() {
      if (typeof document === 'undefined') return () => {};
      if (document.querySelector('style[data-ant="styles"]')) return () => {};
      const element = document.createElement('style');
      element.setAttribute('data-ant', 'styles');
      element.textContent = STYLES + CUSTOM_CSS;
      document.head.appendChild(element);
      return () => { element.remove(); };
    }

    function createShell() {
      let open = false;
      let catalog;
      const listeners = new Set();
      const emit = () => { for (const listener of [...listeners]) listener(); };
      return {
        getSnapshot: () => open,
        subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        set(next) { if (next === open) return; open = next; emit(); },
        toggle() { open = !open; emit(); },
        setCatalog(next) { catalog = next; },
        catalog: () => (typeof catalog === 'function' ? catalog() : undefined),
        dispose() { listeners.clear(); },
      };
    }
    function useModel(model) { return React.useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot); }

    function useLocale(locale) { React.useSyncExternalStore(locale.subscribe, locale.snapshot, locale.snapshot); return locale; }

    function useShell(shell) { return React.useSyncExternalStore(shell.subscribe, shell.getSnapshot, shell.getSnapshot); }

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

    function directoryOf(ctx, sessionId) {
      try {
        const directories = typeof ctx.get === 'function' ? ctx.get('modelDirectories') : undefined;
        if (!directories || sessionId === undefined) return undefined;
        return directories.directoryFor(sessionId);
      } catch (error) { trace('catalog-failed', error); return undefined; }
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
