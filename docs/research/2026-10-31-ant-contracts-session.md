# DSH 会话、模型路由与普通消息投递契约研究

- 研究票：Wayfinder #10《核实 DSH 会话、模型路由与普通消息投递契约》
- 目标版本：DSH `0.2.1-rc.2`
- 研究日期：2026-10-31
- 研究方式：只读源码、安装包元数据、现有测试、生成的 Typert schema、官方发布包 README
- 结论等级：
  - **直接观察**：由当前安装文件、测试或发布包正文直接读到。
  - **静态推断**：由调用关系、命名和控制流推出，未通过 live remote 运行验证。
  - **未覆盖**：本次没有证据支持，不能把推断写成事实。

## 摘要结论

1. `sessionController.selectModel` 的选择先作用于当前 Session/Agent，再异步写全局默认模型。当前 Session 的选择通过 `model/selection` durable event 和 live selection cache 生效；返回结果不等待全局默认持久化完成。直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\index.js:789-821`、`...\lib\types\agent.js:275-355`。
2. 普通 `sessionController.prompt` 的 `queue` 路径调用 `agent.followup`，进入 `next-turn`；`steer` 路径调用 `agent.steer`，进入 `next-step` 并唤醒当前 Agent。`{accepted:true}` 是 admission/入箱确认，不是 turn 完成、模型输出完成或 assistant 消息已落盘。直接观察：`...\lib\index.js:918-966`；底层队列语义：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-agent-loop\lib\index.js:802-823`。
3. 普通 prompt 的幂等键是 request `requestId`，持久消息来源为 `source.kind === 'user'` 且 `source.rpcId === requestId`。命中 `nextTurn`、`nextStep` 或历史事件后直接返回 `{accepted:true}`。这是 admission 幂等；并发相同 requestId 的外部竞态没有本次测试证据。直接观察：`...\lib\index.js:927-950,1128-1139`。
4. 普通 Session 的 durable user source 含 `rpcId`、可选 `clientTimeZone`、可选 `principal`；owner invocation 的 principal 会被省略，非 owner principal 保留。直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\types\index.js:498-522`、`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-typert-protocol\lib\types\principal.js:1-14`。
5. Session 查询结果会通过 `ctx.remoteAccess.allows({kind:'session',id})` 过滤；remote-access 对 owner/follow 与非 owner principal policy、resource binding、role/action、condition 分层判定。`sameWorkspace`、`cwd`、label、parent chain 仅有排序、展示或 lineage 意义，不能单独作为 remote authorization 证明。直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\types\index.js:334-353`、`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-remote-access\lib\index.js:222-325`；“展示字段不是权限证明”属于静态推断。
6. `sessionReferenceResolver` 只解析 user-source 消息，把引用替换成 mention 并在 pre-step 生成有界、只读、不可信的快照上下文；不是 fork、resume、subscription 或 live link。host 负责提供 `sessionQuery` 读取边界。直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-session-reference\lib\index.js:394-742`、本地 `README.md:12,32-53,69-89,132-137`。
7. AgentTeams 插件把 host `dsh.subagent.deliverPrompt` seam 作为普通成员消息入口：`queue` 与 `steer` 明确分开，并以 `source.kind:'agent-teams'` 投递；插件自己的 mailbox receipt/attempt ACK 是另一层状态确认，不等于 host `sessionController.prompt` ACK。直接观察：`D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\src\harness-compat.ts:1-167`、`src\members.ts:790-824`、`src\mailbox.ts:116-171`。
8. 当前验证覆盖的是插件现有 `lib` 构建产物和 fixture/contract tests；没有 rebuild，所以未证明 `src` 与 `lib` 的新鲜度，也没有 live remote principal、正式部署 Session policy 注册或并发同 requestId 的动态覆盖。

## 版本与安装物

### 目标包身份

- DSH checkout：`D:\deepseek HARNESS\resources\app\dsh\package.json:1-5` 标记 `@deepseek-ai/dsh-desktop-runtime` `0.2.1-rc.2`。
- Controller：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\package.json:1-15` 标记 `0.2.1-rc.2`，repository 为 `https://github.com/deepseek-ai/deepseek-harness.git`，directory 为 `packages/api/session-controller`，main 为 `lib/index.js`，types metadata 指向 `lib/types/index.d.ts`。
- Session reference：本地包 README 与 package metadata 均为 `0.2.1-rc.2`。
- 插件：`D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\package.json:1-3` 为 `@nanmicoder/dsh-agent-teams` `0.1.25`；`:90-112,114-137,214-240` 的 peer/dev dependency pin 到 DSH `0.2.1-rc.2`。
- Node：`node --version` 返回 `v22.23.2`。

### 声明文件覆盖

安装目录枚举发现 controller/reference 的 `lib` 下实际是 JS mirror 与生成的 Typert host/remote 文件，例如：

- `...\dsh-api-session-controller\lib\types\index.js`
- `...\dsh-api-session-controller\lib\typert.host.js`
- `...\dsh-session-reference\lib\types\config.js`
- `...\dsh-session-reference\lib\typert.host.js`

枚举没有发现 `lib/types/index.d.ts` 的实际文件。package metadata 声明了 `.d.ts` 路径，但当前安装目录没有对应文件；因此本笔记以运行时 JS、Typert generated declaration 字符串与 README 为准，并把 `.d.ts` 可读性列为覆盖缺口。package files 清单也不包含原始 TS/source/test：`...\dsh-api-session-controller\package.json:57-67`。

## 一、模型选择契约

### 1. selectModel 的调用顺序

直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\index.js:789-821`。

调用顺序为：

1. 通过 `resolveAgent(request.sessionId)` 解析 live Agent，冷 Session 会按 controller 的 resume/claim 规则恢复。
2. 在 `agents.serializeImageAdmission(agent, ...)` 串行链中执行模型可用性与图片能力相关校验。
3. `requireModel` 验证 provider/model。
4. `ctx.llm.resolveCallConfig({provider, model, reasoningEffort})` 归一化调用配置。
5. `this.agents.selectForNextRequest(agent, selected)`：写入当前 Agent 的 Session-local selection。
6. `this.ctx.agentDefaultModel.saveSelection(selected).catch(...)`：后台保存全局默认选择；失败只记录 warning。
7. 返回 `{selected:{provider,model,reasoningEffort?}}`。

关键行：

```text
D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\index.js:808
this.agents.selectForNextRequest(agent, selected);

D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\index.js:809
this.ctx.agentDefaultModel.saveSelection(selected).catch((error) => {
```

### 2. 当前 Session 的生效时点

直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\types\agent.js:275-355`。

- `selectionFor(agent)` 首先读取 `sessionProjections.stateOf(agent.session,'modelSelection')`。
- 有 pending durable projection 时使用 pending selection。
- 没有 pending projection 时，从 request header config 还原；adapter-defaulted reasoning effort 会被排除。
- 再没有 header selection 时，回退 `agentDefaultModel.currentSelection()`。
- `selectForNextRequest` 先 append `model/selection` event，再更新内存 selection current。
- `consumeSelection` 在匹配的 `request/header` route 被记录后退休 pending selection。

**结论：** selectModel 成功返回前，当前 live Agent 已安装 Session-local selection；durable event 使该选择可在 Session resume/replay 时恢复。global default persistence 是独立的后台路径。

### 3. 跨 Session 行为

直接观察：默认值写入调用为 `ctx.agentDefaultModel.saveSelection(selected)`，而 Session-local 选择写入 `model/selection` durable event。由此可直接区分两层：

- 当前 Session：立即生效。
- 新建或没有自身 pending selection 的其他 Session：会从 global default 读取。
- 有自身 `model/selection` pending projection 的 Session：优先自身 durable selection。

“其他 Session 何时可观察到 global default 的异步保存结果”没有本次动态测试。save 成功/失败、并发 selectModel 与默认保存之间的竞争也没有 live remote 证据。

### 4. Host adapter 约束

- Adapter 在收到 selectModel ACK 后，可立即把返回的 selected 视为当前 Session 的 route。
- Adapter 不得把 ACK 解释为 global default 已持久化。
- 需要保存跨 Session 默认路由时，应单独验证 `agentDefaultModel.saveSelection` 的完成状态；当前 service 没有把该后台 Promise 暴露给调用方。
- 复用 Session 时，优先读取 Session-local projection，再决定是否采用 global default。

## 二、普通 prompt、queue/steer 与 ACK

### 1. 来源构造

直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\types\index.js:498-522`。

普通 prompt 的 remote wrapper：

- 检查 `AbortSignal`。
- 检查 content 是否包含非空白文本或 attachment。
- 检查 client timezone。
- 构造 `source`：`{kind:'user', rpcId, clientTimeZone?, principal?}`。
- `principal` 来自 `principalOf(ctx.invocation)`。
- owner invocation 的 principal 返回 undefined；非 owner invocation 保留 peer principal。
- 空内容映射 `gateway/bad-request`，reason 为 `prompt content must include non-whitespace text or an attachment`。

### 2. queue 与 steer

直接观察：

- Controller：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\index.js:918-966`。
- Agent loop：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-agent-loop\lib\index.js:802-823`。

Controller 分支：

```text
request.mode === 'steer'  -> agent.steer(message)
其他 mode                  -> agent.followup(message)
```

Agent loop 的真实队列行为：

- `followup(input)` 调 `send(input,'next-turn',true)`。
- `steer(input)` 调 `send(input,'next-step',true)`。
- `send` 将消息插入 inbox；`wakeup=true` 会唤醒 idle Agent。
- running Agent 收到消息时，wake 会挂到当前 phase，之后继续处理。
- aborted phase 的唤醒会被重分类到 `next-turn`，避免在已 abort 的 step 上继续 steering。

因此 queue 与 steer 是可观察的不同 host contract：queue 创建后续独立 turn，steer 进入最近 step/wake 路径。

### 3. prompt ACK 语义

直接观察：

- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\index.js:927-966` 成功只返回 `{accepted:true}`。
- `...\dsh-api-session-controller\lib\typert.host.js:2013-2153` 的生成 service metadata 将 prompt 结果描述为 Agent accepted 的 acknowledgement。

Admission 阶段包括：

- requestId 幂等检查。
- 图片 admission 串行化与当前模型图片能力检查。
- prompt file receipt 解析与 attachment admission。
- Agent 在 admission 期间 dispose 时抛 `session/not-found`。
- message binding commit。

**ACK 不表示：**

- turn 已开始或已结束；
- assistant message 已生成；
- 模型调用已完成；
- 工具调用已完成；
- inbox 后续消费成功；
- plugin mailbox 已读或 task attempt 已更新。

### 4. requestId 幂等

直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\index.js:1128-1139`。

`hasPromptRequest(agent, requestId)` 在以下区域查找：

- `agent.inbox.nextTurn`；
- `agent.inbox.nextStep`；
- `agent.session.snapshotEvents()`。

匹配条件：`source.kind === 'user' && 'rpcId' in source && source.rpcId === requestId`。命中后直接返回 `{accepted:true}`。

**实现约束：** requestId 的重试应该返回同一 admission 成功语义；Host adapter 不能因为重试而重复产生 user message。并发相同 requestId 的外部竞态没有动态测试证据。

### 5. 取消、忙碌与错误映射

直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\index.js:1057-1066`。

- `cancel` 只从 live `ctx.agents.get` 取 Agent。
- 没有 live attachment：`session/not-found`。
- subagent-owned Session：`session/agent-busy`。
- 调 `agent.cancel({kind:'user'},{keepInbox:true})`。
- 返回 `{accepted:true}`。

`prompt` 错误映射：

- 已知 `RemoteError` 原样透传。
- `AttachmentError` -> `session/attachment-invalid`。
- 其他 admission/Agent 错误 -> `session/agent-busy`。
- Agent 在 admission 中 dispose -> `session/not-found`。

`updateQueue` 直接观察：`...\lib\index.js:1000-1055`。

- edit 只接受 text blocks，且文本必须含非空白字符。
- 冷 Agent 先 resume；无法解析 item -> `session/queue-item-not-found`。
- item 只从 `nextTurn` / `nextStep` 定位。
- steer 仅允许 `target:'next-turn' && agent.status === 'running'`，否则 `session/steer-unavailable`。
- remove 会 retire prompt upload。
- steer 删除 queue item 后调用 `agent.steer(message)`。

## 三、普通 Session 身份、授权映射与 resolver 边界

### 1. Session header 与 parentSession

直接观察：

- Controller 读取 `session.header.parentSession`：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\index.js:130`。
- 由普通 Session 创建 child/subagent 时，source header 的 id 作为 `parentSession`：`...\lib\index.js:889`。
- 子 Agent 地址还会校验 header `origin === 'subagent'` 与提供的 parent id 相等：`...\lib\index.js:1696`。

`parentSession` 是 lineage/ownership 输入，单独存在时不构成普通 Session 的授权结论。

### 2. remote-access 授权

直接观察：

- 列表/搜索返回值先调用 `ctx.remoteAccess.allows({kind:'session',id:item.sessionId})`：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\types\index.js:334-353`。
- `remote-access` owner/follow 直接分支与非 owner policy 分支位于 `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-remote-access\lib\index.js:222-260`。
- 非 owner 需要 principal-kind policy、resource binding、role action、condition；缺项或失败 deny：同文件 `:222-260`。
- grant invalidation/follow delta：同文件 `:263-325`。

本次在安装包中只找到 `registerPolicy` 定义命中，未找到部署层 Session policy registration 的具体调用点；该结论来自全 @deepseek-ai grep，属于“未定位”，不是“运行时没有 policy”。

### 3. Session query 读取边界

直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-session-query\lib\index.js:21-65,90-157,1163-1175`。

- query 合并 live/cold corpus。
- `readSurface` 读取 corpus 当前 surface events。
- 本次读到的 `readSurface` 实现没有独立 remote-auth check。
- controller/list/search 上层的 remoteAccess filter 才是已观察到的授权入口。

**静态推断：** `sameWorkspace`、cwd、label、projected title、parent chain 可用于候选排序、显示、恢复与 lineage 判定，但不能单独充当授权证明。

### 4. 插件 lineage 与普通 Session 边界

直接观察：`D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\src\lineage.ts:1-248`。

- fork 是第一类 DSH 操作，child header 用 `parentSession` 指向源。
- `LINEAGE_MAX_DEPTH=32`。
- liveSession 优先 `ctx.agents.get`，再 optional sessions registry，再 optional durable stat。
- top-level 定义：`header.origin !== 'subagent' && delegationDepth===0`。
- ancestry 最多 32 层，cycle-bounded，并有缓存。
- listed member id 永远不是 lead。
- captain exact id 是 lead。
- 只有 inheritsLead 的 top-level fork descendant 可继承 captain lead。
- 从 member fork 出发的 ancestry 含 member id，因此不获得 captain lead authorization。

**结论：** 普通 Session 身份不能仅靠 parent chain 推出团队 lead 权限；插件要求 top-level 与 captain ancestry 条件同时成立。

## 四、会话恢复、失效与终止

### 1. 创建与复用

直接观察：

- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\index.js:734-787`：`workspaceId` 与 `cwd` 互斥；workspace 必须存在；cwd 取 workspace.path、request.cwd 或 defaultCwd。
- `...\lib\types\agent.js:252-273`：无 sessionId 时 mint；有 sessionId 时通过 `inOrder` 串行 claim。
- `...\lib\types\agent.js:437-513`：只有 `request.reusable(sessionId)` 且观察事件没有 `turn/start` 时，冷 Session 才可复用；观察后 writer race 或已经开始 turn 会 mint 新 Session/重试。
- `...\lib\types\agent.js:515-580`：live reuse 要求 reusable 且 blank；blank 判断依赖 turn boundary 与 lastTurn；minted id 格式为 `session-${randomUUID()}`。

### 2. 恢复错误与 ownership gate

直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\types\agent.js:61-249,393-435`。

- header.id 必须精确等于 requested sessionId。
- header.cwd 必须存在。
- subagent-owned Session 被拒绝普通 controller resume。
- 已附着 Agent 优先复用 live instance。
- `resumes` Map 按 sessionId 去重，共享 resume Promise。
- not-found -> `session/not-found`。
- subagent ownership -> `session/agent-busy`。
- writer collision -> `session/writer-held`。
- 其他错误 -> gateway/internal。
- shared resume 后再次检查 live ownership。

### 3. Agent 终止与恢复

直接观察：

- Agent owner/initiator/detach/dispose：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-agent\lib\types\index.js:22-31,102-112,227-239,241-295,355-432`。
- Agent initiator 表示因果来源，不等于 durable parent lineage，也不等于 liveness/auth：同文件 `:22-31,102-112,227-239`。
- scope closing/drain/disposed 后 future ops 报 `agent initiator scope is disposed`：同文件 `:383-432`。
- Agent loop 初始化失败会 cancel disposed、保留 inbox 并 dispose；resume 会取得 write handle、replay、追加 interrupted closers、setup/publish，再释放未转移资源：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-agent-loop\lib\index.js:1789-1827,1930-2035`。
- step 失败时会先恢复 pending tool results，再写 turn/end error/aborted；恢复失败会抛 `AggregateError`，reason 为 `Step failed and its pending tool results could not be recorded`：同文件 `:960-1039`。
- ACP resume 另有 active/attached/subagent/parent/cwd mismatch gate：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-acp\lib\index.js:712-731,1250-1296`。它不等于普通 Session controller contract。

### 4. Client Session 常驻语义

直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\types\client\sessions\session.js:1-12,28-122`。

- 创建后的 client Session resident，open Remote source 可在屏幕外继续运行。
- `openState`、`openGeneration`、`running`、`removed`、`promptError`、`pendingSubmissions` 记录客户端状态。
- `beginSubmission` 生成 randomUUID requestId；running 时标记 steering，非 running 时按 queue/transcript 分类：`:142-163`。
- ordinary cancel 调 remote `session.cancel`；subagent cancel 调 `interruptByParent`：`:246-267`。

## 五、sessionReferenceResolver 契约

### 1. URI 与 mention

直接观察：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-session-reference\lib\index.js:274-347`。

- canonical scheme：`dsh-session:`。
- payload 是 JSON string sessionId 的 base64url。
- decode 要求 scheme、非空 base64url、decoded JSON 为 string、重新编码后与原 URI 完全一致。
- mention 格式：`@[label](dsh-session:...)`。
- malformed URI：`SessionReferenceError` code `SESSION_REFERENCE_INVALID_REFERENCE`。

### 2. 解析来源与候选

直接观察：`...\dsh-session-reference\lib\index.js:394-601`。

- config：`maxReferences` 默认 3，范围 1..3；`candidateLimit` 默认 50；`maxReferenceBytes` 为正整数；`referenceContextFraction` 默认 0.2，范围 0..1。
- resolver 注册 `system-prompt/assemble` route capture 与 `agent/pre-step` preparation。
- 只处理 `message.source.kind === 'user'`。
- `listCandidates` 从 `sessionQuery.listSessions(signal)` 取记录，排除自身，按 id/cwd/projected title/displayTitle 过滤。
- 排序：same cwd rank 0，cwd 缺失 rank 1，different cwd rank 2。
- attached session 使用 live projection snapshot，cold session 使用 projection cache；subagent displayTitle 优先；title 缺失回退 id。
- 没有 projection 的历史 Session 按 title 搜索不到，需打开或 checkpoint 后才有 title。

README 一手材料：

- 本地：`D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-session-reference\README.md:12,32-53,69-89,132-137`。
- Envoy：`https://unpkg.com/@deepseek-ai/dsh-session-reference@0.2.1-rc.2/README.md`。
- Envoy receipt：`material_id=mat-ebcbb64ed135568d10d940c5`；`source_revision=6e707f287ab3`；`session_id=mcp-c164e925db72402cb116d6c80a3886ec`；stable blocks `blk-title`、`blk-body-0001`；normalized URL locator `/README#...`；最终返回范围 `0-12058`，首次显示曾标记 6969/12067 字符截断，随后服务返回 `error range_already_delivered`，说明剩余范围已在同一 material 中交付。

### 3. 快照准备与预算

直接观察：`...\dsh-session-reference\lib\index.js:603-742`。

- `prepare` 对 content 做 structured clone。
- 规范化 object references：`sessionId` 必须是 string，可有 label。
- self-reference -> `SESSION_REFERENCE_SELF_REFERENCE`。
- duplicate ids 去重。
- 超出 maxReferences -> `SESSION_REFERENCE_TOO_MANY`。
- 每个 reference 调 `sessionQuery.readSurface`；读取失败 -> `SESSION_REFERENCE_READ_FAILED`。
- 读取和保存之后检查 cancellation；取消 -> `SESSION_REFERENCE_CANCELLED`，且不发布 context。
- 输出一个额外 user message，source 为：

```text
{kind:'session-reference', form:'recall', version:1, references:[...stats]}
```

- 快照正文带有只读、不可信、JSON 不能覆盖系统指令的固定提示。
- 显式 `maxReferenceBytes` 优先。
- 否则使用 assembly route 的 provider/model context window：`max(65536, floor(contextWindow * 4 * 0.2))`。
- 缺少 route/llm/adapter/context 时使用 64 KiB；其他 lookup error 继续失败。

### 4. Resolver 边界

README 明确：

- candidate 查询只看 id/cwd/title/projected labels，不查会话正文。
- host 是 trusted caller boundary，假设 host 已经掌握 `ctx.sessionQuery` 的读取权限。
- reference 是 frozen text snapshot。
- reference 不是 fork、resume、subscription 或 live link。
- projection 为 text-only，spill 过大时有 omission notice。

因此 Host adapter 应把 resolver 读取权限视为上游边界，在向 resolver 提供 sessionQuery 前完成 access policy；不能把 resolver 返回的 candidate 排名或 snapshot source 当作授权证明。

## 六、AgentTeams 插件适配层

### 1. Host seam 与来源身份

直接观察：`D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\src\harness-compat.ts:1-167`。

- seam：`Symbol.for('dsh.subagent.deliverPrompt')`。
- Deliver 参数：`parent: Agent, childId: SessionId, content: ContentBlock[], source: MessageSource, signal: AbortSignal, delivery:'queue'|'steer'`。
- 插件 source kind：`'agent-teams'`。
- `queueMemberPrompt` 使用 delivery `queue`。
- `steerMemberPrompt` 使用 delivery `steer`。
- queue 注释定义为 distinct host-authored turn；steer 为 nearest-step/wake idle/cold child。
- `onAgentReady` 监听 `agent/created` 并使用显式 `payload.agent`。
- `sessionOwnEvents` 要求 host 提供 `ownEvents()`；缺失则 unsupported。
- `installContinuableMemberSetup` 在 agent/created 同步安装 child setup，避免首请求竞态。

### 2. rc.2 适配补回

直接观察：`harness-compat.ts:231-262,292-305`。

- rc.2 的 `SubagentStartRequest`、capabilities、descriptor 不再带 persona/toolFilter；插件在首次请求前通过 `deployment:persona-prefix` scoped section 与 `tools.restrict` 自行恢复。
- unknown tool rejection 会收窄 deny list 并重试。

### 3. 成员路由与冷恢复

直接观察：`D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\src\members.ts:53-164,344-605,653-943`。

- member durable route 保存 provider/model/reasoningEffort/fallback。
- fallback code 仅 `{QUOTA,RATE_LIMIT,AUTH,MISSING_CREDENTIAL,NO_ADAPTER}`，且只切换一次。
- `resolveMemberLlmSelection` 顺序：explicit -> configured defaults -> captain request header -> captain options；model-only default 可发现唯一 owner provider；同 route 保留 captain reasoning effort，changed route omit；explicit default omit effort；最后调用 `ctx.llm.resolveCallConfig`。
- fresh child 读 pending in-memory selection；cold resume 读 durable team member route。
- pre-step 再校验 team captainSessionId、phase 非 staged、team 非 halted、member exact child id/name/status、非 removed/stopping、没有 reassigning task。
- 阻断 admission 返回 `{kind:'reject'}`。
- 失败处理等待 `agent/error` final recovery，再更新 task/member 并唤醒 scheduler。
- `spawnMember` 以 `delivery:'parent'`、`request.parent: captain` 启动，持久化 child id。
- `deliverToMember` 默认 queue，steer 只在调用方显式请求时使用；返回 host seam ACK 的 boolean。
- `interruptMember` 调 `ctx.subagents.interrupt(childId,{kind:'ancestor',agent:captain})`，fire-and-return。
- retired member 保留 catalog 可见，但 queue/send/cold resume 按 exact child id 拒绝。

### 4. 插件 lineage、mailbox 与 ACK 分层

直接观察：

- lineage：`src\lineage.ts:1-248`。
- events：`src\events.ts:1-88`。
- mailbox：`src\mailbox.ts:1-175`。
- state：`src\state.ts:1-300`。

插件规则：

- lineage max depth 32，member fork 不继承 captain lead authorization。
- 已知 `agent-teams/*` event type 时追加 host Session event；否则写 plugin record；每次只走一条 leg，避免重复。
- captain offline 时 `captainSessionOf` 允许 caller fallback，因此 durable record 仍 addressed to captain，但 event 可能落到 fallback Session。
- mailbox receipt 会在 agent/pre-step 读取并 ACK；只有已授权 receipt 被 ack/read。
- captain receipt 需要 `sessionLeadsTeamAsync`；member receipt 映射到具体成员。
- state read 失败时 pass-through 且保留未 ack。
- 只有 obsolete-only trigger 会拒绝新 turn，既有 turn continuation 保留。

**分层结论：**

| 层 | ACK/成功含义 | 不代表 |
|---|---|---|
| Host `sessionController.prompt` | prompt admission 被 Agent 接受，消息进入对应 inbox | turn/模型/工具完成 |
| Host `dsh.subagent.deliverPrompt` | child delivery seam 接受 queue/steer | member task 已完成、mailbox 已读 |
| 插件 `deliverToMember` boolean | seam 调用返回并被插件转换为 boolean | durable task attempt 已结算 |
| 插件 mailbox ACK | 已授权 receipt 被当前 recipient 读取/确认 | host prompt 生成成功 |
| task attempt terminal report | 任务结果已进入 durable task state | 旧 attempt 仍可写入 |

## 七、现有测试与实际验证

### 1. 已执行命令

以下命令均为只读测试/检查，未 rebuild：

```powershell
cd D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router
node --test scripts/harness-compat-tdd.mjs scripts/stability-tdd.mjs scripts/projection-tdd.mjs scripts/plugin-records-tdd.mjs
node --test scripts/client-harness-migration.test.mjs scripts/workspace-activity.test.mjs
node scripts/lifecycle-verify.mjs
node --test scripts/member-failure-tdd.mjs scripts/capabilities.test.mjs scripts/issue-159.test.mjs
pnpm typecheck
node --version
```

目标源码命中复核：

```powershell
Select-String -Path <target-files> -Pattern 'selectForNextRequest|saveSelection|hasPromptRequest|agent\.steer|agent\.followup|keepInbox|parentSession|sessionOwnEvents|deliverPrompt|sameWorkspace|readSurface|SESSION_REFERENCE_CANCELLED'
```

### 2. 结果

- `harness-compat-tdd + stability-tdd + projection-tdd + plugin-records-tdd`：TAP `tests 37`, `pass 37`, `fail 0`, `skipped 0`，duration `3027.6882ms`；包含 host-built Session cross-copy case，未 skip。
- `client-harness-migration + workspace-activity`：`tests 10`, `pass 10`, `fail 0`, `skipped 0`，duration `220.8861ms`。
- `lifecycle-verify.mjs`：全项输出 `PASS`，末尾 `all lifecycle checks passed`。
- `member-failure-tdd + capabilities.test + issue-159.test`：TAP `tests 42`, `pass 42`, `fail 0`, `skipped 0`，duration `7115.3804ms`。
- `pnpm typecheck`：PowerShell 工具返回的 stderr 仅为底层命令 `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit`，未报告非零退出标记或诊断文本。
- Node：`v22.23.2`。
- `git status --short -- docs/research D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router` 在当前主仓库上下文报错：插件路径位于另一个仓库之外。该命令不改变文件；插件工作树未在本仓库 git 状态下验证。

### 3. 测试覆盖的关键行为

- `scripts\harness-compat-tdd.mjs:84-423`：real Cordis/SubagentRuntime 与 manager double；FIFO seam、receiver、retirement、ownEvents、agent/created 同步 setup、cold route/effort/fallback restore、persona/tools composition、queue/steer、serial first-request admission。
- `scripts\stability-tdd.mjs:37-159`：inbox admission、reject 不消费、duplicate wake、stale generation、steer seam 与 public sendMessage 分离、stopped/retired/missing-team、member-relative delegation guard。
- `scripts\plugin-records-tdd.mjs:1-9,103-119`：foreign Session private receiver 拒绝，多包副本边界。
- `scripts\projection-tdd.mjs:34-191`：状态折叠、创建/member/task/message delta、lifecycle transition、plugin record 与 known event 等价性、registry/service mounting。
- `scripts\lifecycle-verify.mjs:1-9,20-35,43-92,162-283`：真实编译 tool definition + fake Agent/manager/storage fixture；验证插件生命周期，不是 live remote e2e。
- `scripts\member-failure-tdd.mjs:1-12,24-351`：llm-retry fixture、recovery/final failure/whenIdle/stale attempt、mailbox、lock race、captain unavailable、removed member。
- `scripts\client-harness-migration.test.mjs:6-46`：mainView ownership、continuable parent/child/mode、legacy navigation、failed tool-result cards、turn-bound cards。
- `scripts\workspace-activity.test.mjs:6-51`：discovery、historical owner binding、offline recovery、late response disposal、DAG geometry。

### 4. 测试限制

- 测试使用插件现有 `lib` 构建产物；本次没有执行 build，因此不证明当前 `src` 已编译进 `lib`。
- DSH checkout 目标 package files 未提供原始 TS/source/test；本次源码证据来自已安装 `lib`。
- 没有 live remote sessionController call。
- 没有动态验证 invocation owner/non-owner principal 写入与 remote policy deny/allow。
- 没有定位正式部署层 Session policy registration。
- 没有并发相同 requestId 的动态竞态测试。
- 没有扩展 source map 或对安装 `.bak`、`.dshpurge.bak` 与当前 `lib` 做字节身份核对。
- ACP resume 是独立 contract，不能替代普通 Session controller 验证。

## 八、可直接转成 Host adapter / 测试约束

| 编号 | 约束 | 证据 | 适配/测试动作 |
|---|---|---|---|
| H1 | selectModel 先 Session-local 生效，再后台保存 global default | controller `lib/index.js:789-821`; agent `lib/types/agent.js:275-355` | mock saveSelection 延迟/失败；断言 ACK 已返回且当前 Agent route 已切换；断言 save 失败只 warn |
| H2 | Session-local model selection 由 durable event 恢复，优先级高于 global default | agent `lib/types/agent.js:275-355` | cold resume 有 pending `model/selection` 时不读取 global route 作为最终值 |
| H3 | queue→followup/next-turn；steer→steer/next-step | controller `lib/index.js:918-966`; agent-loop `lib/index.js:802-813` | 分别断言 inbox target、wake 行为与 running/idle 状态 |
| H4 | prompt ACK 仅 admission ACK | controller `lib/index.js:918-966`; Typert metadata `typert.host.js:2013-2153` | ACK 后延迟 turn completion/assistant output；adapter 不提前宣称完成 |
| H5 | requestId 重试幂等，重复 prompt 不追加 user message | controller `lib/index.js:927-950,1128-1139` | same requestId 重复调用；断言一次入箱、多次 `{accepted:true}` |
| H6 | cancel 保留 pending inbox | controller `lib/index.js:1057-1066` | running + queued inbox 场景；cancel 后断言 active turn abort、queued message 仍在 |
| H7 | ordinary prompt source 是 user/rpcId/principal；owner principal omitted | controller `lib/types/index.js:498-522`; principal `principal.js:1-14` | owner/non-owner invocation fixture；检查 durable source 字段 |
| H8 | list/search access 走 remoteAccess；cwd/label/sameWorkspace 不单独授予权限 | controller `lib/types/index.js:334-353`; remote-access `lib/index.js:222-325` | session candidate policy deny/allow fixture；拒绝“同 cwd 即授权”断言 |
| H9 | resolver 只读 user-source，并生成 bounded untrusted snapshot | session-reference `lib/index.js:394-742`; README | assistant/tool/plugin-source message 不应触发引用解析；快照正文不能成为 system instruction |
| H10 | resolver 不做正文搜索、不建立 live link | README `:69-89,132-137`；Envoy material | candidate 只用 id/cwd/title；snapshot 后源 Session 修改不影响已生成 context |
| H11 | self reference/duplicate/limit/read failure/cancel 有稳定错误码 | session-reference `lib/index.js:603-742` | 覆盖 `SESSION_REFERENCE_SELF_REFERENCE`, `SESSION_REFERENCE_TOO_MANY`, `SESSION_REFERENCE_READ_FAILED`, `SESSION_REFERENCE_CANCELLED` |
| H12 | plugin queue/steer 使用 host delivery seam 与 `agent-teams` source | `src/harness-compat.ts:1-167`; `src/members.ts:790-824` | seam 缺失、ownEvents 缺失、retired child、queue/steer 分支分别测试 |
| H13 | plugin mailbox ACK 与 host prompt ACK 分开 | `src/mailbox.ts:116-171`; controller prompt | 测试 host accepted 但 mailbox 未读、mailbox read 但 task 未终结的中间态 |
| H14 | 普通 controller 不直接 resume subagent-owned Session | controller `types/agent.js:61-249,393-435` | child ownership/cwd mismatch/writer collision 错误映射测试 |
| H15 | member/member fork 不继承 captain lead authorization | `src/lineage.ts:161-195` | top-level captain fork、member、member fork 三类 identity matrix |
| H16 | retired member catalog 保留，delivery/cold resume 拒绝 | `src/members.ts:842-857`; scripts stability | historical transcript 可见、new prompt/cold resume 失败 |
| H17 | resume/termination 要处理 pending tool recovery 与 interrupted closers | `dsh-agent-loop/lib/index.js:960-1039,1930-2035` | step fail、cancel、resume、tool result recovery fixture |
| H18 | source package declarations 与实际 `.d.ts` 文件可能不一致 | package metadata + installed file enumeration | adapter 构建不要盲信 `types` path；把 runtime JS/generated Typert 作为当前证据 |

## 九、未覆盖与待补证据

1. **正式部署 policy registration**：安装包中定位到 `registerPolicy` 定义，但没有找到具体 Session policy 注册调用点。需要从 DSH desktop composition/boot manifest 或运行时 inspect 获取。
2. **live principal 动态验证**：尚未通过 remote service 调用 owner/non-owner invocation，无法把静态 remote-access 分支扩展为部署行为结论。
3. **global default save completion**：没有观察 `saveSelection` Promise 的完成、失败重试或跨 Session 可见时点。
4. **并发同 requestId**：已有重复请求扫描逻辑，但没有并发竞态测试；无法确认两次 admission 在极窄 race 下是否严格单写。
5. **真实冷恢复与 writer race**：controller 静态代码已覆盖 race fallback，但本次插件 fixture 未作为 live DSH session e2e 执行。
6. **安装物字节身份**：目标目录发现 `.bak`、`.dshpurge.bak` 等旁支文件；未做 package tarball/source-map/sha256 对照，不能据此声明当前 `lib` 等于官方发布字节。
7. **`.d.ts` 交付状态**：package metadata 指向 `lib/types/index.d.ts`，本地枚举没有发现该文件；需要在正式 Host adapter 编译链中再核对 package extraction/loader 行为。
8. **ACP 与普通 Session 交界**：ACP 的 resume/close 规则已单独定位，但没有验证普通 controller 与 ACP 同时操作同一 Session 的冲突语义。
9. **client Session resident 的真实窗口行为**：源码说明 open Remote source 可屏幕外继续运行，但没有 GUI/remote live capture。

## 十、证据索引

### 本地源码与测试

- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\index.js:789-821,918-966,1000-1066,1128-1139,1696`
- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\types\agent.js:61-249,252-365,393-580`
- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\types\index.js:334-353,498-522`
- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-session-controller\lib\typert.host.js:1170-1204,1239-1248,2013-2153`
- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-agent-loop\lib\index.js:802-823,960-1039,1789-1827,1930-2035`
- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-agent\lib\types\index.js:22-31,102-112,227-239,241-295,355-432`
- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-session-query\lib\index.js:21-65,90-157,1163-1175`
- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-api-remote-access\lib\index.js:222-325`
- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-typert-protocol\lib\types\principal.js:1-14`
- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-session-reference\lib\index.js:274-742`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\src\harness-compat.ts:1-167,231-305`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\src\members.ts:53-164,344-605,653-943`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\src\lineage.ts:1-248`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\src\events.ts:1-88`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\src\mailbox.ts:1-175`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\src\state.ts:1-300`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\scripts\harness-compat-tdd.mjs:84-423`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\scripts\stability-tdd.mjs:37-159`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\scripts\projection-tdd.mjs:34-191`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\scripts\plugin-records-tdd.mjs:1-9,103-119`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\scripts\lifecycle-verify.mjs:1-9,20-35,43-92,162-283`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\scripts\member-failure-tdd.mjs:1-12,24-351`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\scripts\client-harness-migration.test.mjs:6-46`
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\scripts\workspace-activity.test.mjs:6-51`

### 官方发布包一手材料

- URL：`https://unpkg.com/@deepseek-ai/dsh-session-reference@0.2.1-rc.2/README.md`
- Envoy `material_id`：`mat-ebcbb64ed135568d10d940c5`
- Envoy `source_revision`：`6e707f287ab3`
- Envoy `session_id`：`mcp-c164e925db72402cb116d6c80a3886ec`
- Envoy stable blocks：`blk-title`、`blk-body-0001`
- Coverage：material 最终交付范围 `0-12058`；README 内容支持 canonical mention、bounded frozen snapshot、候选排序、maxRefs=3、candidateLimit=50、自动预算、pre-step capture、text-only projection、spill cancellation、assembly route budget、host trusted boundary、无正文搜索与无 live link。

## 结论边界

本笔记可直接支撑 Host adapter 的输入映射、ACK 解释、queue/steer 分层、Session-local model selection、普通 Session access gate、resolver snapshot 边界与 AgentTeams plugin seam 测试。对于正式部署 policy registration、live principal authorization、后台默认保存完成时点、并发同 requestId 竞态、真实 DSH remote e2e 与安装物字节身份，当前证据只到“未覆盖”，不延伸为事实。
