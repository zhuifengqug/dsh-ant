# 虫珀·玄驹 Host 状态层与类型化动作契约

状态：设计稿，已通过用户复审；未实现、未安装、未作为运行时证明。

本稿把 T1 架构基线转换为 Host 状态层、统一动作入口、静态 Client Remote 与适配器边界。领域词汇以根目录 [GLOSSARY.md](../../GLOSSARY.md) 为准，事实源决策见 [ADR-0001](../adr/0001-team-wal-as-canonical-owner.md)，运行时基线见 [架构基线](ant-baseline.md)。

## 1. 目标与非目标

目标：在 DSH `0.2.1-rc.2` / Node `22.23.2` 上，为代码仓库任务定义一个可重放、可恢复、可人工接管的团队 Host 契约；Web UI、Headless、`/ant` 与 agent tool 使用同一动作语义。

非目标：本稿不实现 WAL、writer lease、Host Service、Typert 生成产物、Client 页面、Agent loop 修改、普通 Session policy registration、安装 bundle 或端到端运行。`storageDomain/storage-json`、Session projection、Session record 与 `agentTeams` 仍分别承担派生净状态、Session 折叠、Travelling Copy 和兼容边界，不成为 Team WAL owner。

## 2. Owner 分层

### 2.1 TeamActionService

`TeamActionService` 是唯一写入与状态迁移 owner，负责：

- 严格解析动作输入、生命周期、成员、任务、attempt 与 CAS 游标校验；
- 从可信 Host 调用上下文取得 `surface`、`principal`、用户/成员/系统身份与 authority，不接受请求 JSON 自报身份；
- 取得数据根级 `TeamWriterLease`，处理 lease conflict/lost；
- 查找 `requestId`/`idempotencyKey`，生成事件 envelope 并 durable append Team WAL；
- 在 WAL 提交后折叠 snapshot/read model，发布失效通知并生成统一 receipt/error。

`TeamActionService` 的内部 dispatcher 是 Host、Web、Headless、`/ant` 与 agent tool 的共同业务入口。适配器不得复制授权、幂等、WAL 或生命周期逻辑。对同一 `teamId` 的动作在单 Host 内串行化；不同团队仍可并行。`team.create` 以数据根级 writer lease 与创建幂等键串行化，避免两个请求生成两个事实团队。

### 2.2 TeamViewService

`TeamViewService` 只读 Team WAL，折叠出 `TeamView`，提供团队详情与列表。Team snapshot、任务 DAG、邮箱读面、归档列表与 Client 展示状态均是可重建派生物。读面折叠失败不得回滚已经 durable append 的 Team WAL；应返回已提交事实对应的 `rebuild-required` 状态并保留人工处理信号。

### 2.3 TeamWriterLease

`TeamWriterLease` 是同一玄驹数据根的单 Host 写入抽象，最小操作为：

- `acquire(root, ownerId): Promise<{ ownerId: string; epoch: number; fencingToken: string }>`；
- `renew(ownerId, epoch, fencingToken)`；
- `release(ownerId, epoch, fencingToken)`；
- `status(root): { ownerId?: string; epoch?: number; fencingToken?: string }`。

V1 要求同一数据根只允许一个 DSH Host 写入；单 Host 内可以并行多个团队、成员与任务。第二 Host 必须收到显式 `team/lease-conflict`，不得静默创建分叉事实。每次 Team WAL append 都必须带当前 `epoch` 与 `fencingToken`，由 writer lease 在落盘前校验；旧 Host 或失去租约的写入必须返回 `team/lease-lost`。POSIX、Windows、macOS 的物理锁、心跳、崩溃释放和后继恢复属于实现与验证边界，不在本稿假定具体 API；不得复用 DSH Session 私有锁。

### 2.4 TeamSessionAdapter

`TeamSessionAdapter` 负责把成员身份绑定到稳定 `sessionId`，通过 DSH `sessionController` 发送 `queue`/`steer`，并把 Host admission ACK 与邮箱的投递、读取、消费、完成回执分别写入 Team WAL。`accepted` 仅表示进入 Agent inbox，不表示模型输出、工具执行或任务完成。普通换模型按 `selectModel` 的 pending-selection 语义从下一请求生效；迁移并继续是独立人工动作。

## 3. 静态 Client Remote 与公开 ABI

静态插件不使用动态 Host/Client package 的 `host.call`/`harness.handle` bridge。公开面采用 Typert 生成的 Host `./typert` 与 Client `./remote`。

真实 wire endpoint 只有三项：

| 用途 | Wire endpoint | Client 调用 | 权限性质 |
|---|---|---|---|
| 统一写入 | `team/dispatch` | `remote.team.dispatch(request)` | 按动作判定 |
| 团队读取 | `team/get` | `remote.team.get(request)` | 只读 |
| 团队列表 | `team/list` | `remote.team.list(request)` | 只读 |

Client manifest 注入 `remote` 与 `remote.team`。`team/dispatch` 是唯一公开写入口；高频动作不另建平行 Remote 方法。Host package exports `./typert`，Client package exports `./remote` 与 Client bundle；Typert loader 发现并注册 Host manifest，嵌套 Loader 项目用显式 package 配置。

`team/changed` 不作为首版读写 ABI；它是后续可挂载的 Remote event source，仅发送明确团队身份与新游标等失效信息，Client 收到后重新调用 `team/get`。首版正确性以 `team/get` 的 WAL cursor 为准，通知丢失不改变团队事实。

### 3.1 TeamView 查询

```ts
type TeamGetRequest = {
  teamId: string
  atLeastEventSeq?: number
}

type TeamListRequest = {
  includeArchived?: boolean
  cursor?: string
  limit?: number
}
```

`team/list` 的 `workspaceRoot` 由 Host 配置绑定，并在 Host 启动与每次查询时校验；它不是 Remote 请求字段，调用方不得选择或覆盖数据根。调用方只能提交 `includeArchived`、分页 `cursor` 与 `limit`；未声明字段由 strict codec 拒绝。`team/get` 与 `team/list` 返回的游标对应各团队 WAL 的可验证 cut；不存在的 `teamId` 返回 `team/not-found`。

## 4. 输入、动作与回执

### 4.1 TeamActionRequest

```ts
interface TeamActionPayloadMap {
  'team.create': TeamCreatePayload
  'plan.confirm': PlanConfirmPayload
  'attempt.dispatch': AttemptDispatchPayload
  'attempt.pause': AttemptPausePayload
  'attempt.resume': AttemptResumePayload
  'attempt.takeover': AttemptTakeoverPayload
  'attempt.terminate': AttemptTerminatePayload
  'attempt.retry': AttemptRetryPayload
  'member.invite': MemberInvitePayload
  'member.accept': MemberAcceptPayload
  'member.remove': MemberRemovePayload
  'member.changeModel': MemberChangeModelPayload
  'mail.send': MailSendPayload
  'mail.read': MailReadPayload
  'mail.consume': MailConsumePayload
  'quality.report': QualityReportPayload
  'team.archive': TeamArchivePayload
  'team.restore': TeamRestorePayload
  'team.delete': TeamDeletePayload
}

type TeamAction = keyof TeamActionPayloadMap
type TeamActionPayload = TeamActionPayloadMap[TeamAction]
type TeamActionRequest = {
  [K in TeamAction]: {
    requestId: string
    action: K
    payload: TeamActionPayloadMap[K]
    expectedEventSeq?: number
  } & (K extends 'team.create' ? { teamId?: never } : { teamId: string })
}[TeamAction]
```

`TeamActionPayload` 由 `TeamActionPayloadMap` 与 `action` 同步判别；各动作 codec 对其专属 payload schema 执行 strict 校验，拒绝缺失、额外或错配字段。Typert codec 在进入 dispatcher 前验证整项联合。

共享 DTO 与动作 payload 的最小字段如下；未列字段一律拒绝，数组项和嵌套对象同样使用 strict codec：

```ts
type PlanTask = {
  taskId: string
  title: string
  objective: string
  inScope: string[]
  outOfScope: string[]
  acceptance: string[]
  verify: string[]
  ownerMemberId?: string
}

type PlanDependency = {
  taskId: string
  blockedByTaskId: string
}

type QualityGate = {
  gateId: string
  taskId: string
  kind: 'verification' | 'review' | 'integration'
  acceptance: string[]
}

type PlanDraft = {
  planId: string
  mode: 'normal' | 'fast'
  tasks: PlanTask[]
  dependencies: PlanDependency[]
  qualityGates: QualityGate[]
  maxActiveAttempts: number
}

type InitialMember = {
  memberId: string
  role: string
  sessionMode: 'persistent' | 'ephemeral'
  sessionId?: string
  provider: string
  model: string
  reasoningEffort?: string
  inScope: string[]
  outOfScope: string[]
  executionPrompt?: string
}

type EvidenceRef = {
  kind: 'file' | 'command' | 'session' | 'event'
  locator: string
  digest?: string
  note?: string
}

type TeamCreatePayload = {
  goal: string
  workspaceRelativePath: string
  plan: PlanDraft
  members: InitialMember[]
}
type PlanConfirmPayload = { planDigest: string }
type AttemptDispatchPayload = { taskId: string; memberId: string }
type AttemptPausePayload = { taskId: string; attemptId: string }
type AttemptResumePayload = { taskId: string; attemptId: string }
type AttemptTakeoverPayload = { taskId: string; attemptId: string }
type AttemptTerminatePayload = { taskId: string; attemptId: string; reason?: string }
type AttemptRetryPayload = { taskId: string; previousAttemptId: string; memberId: string }
type MemberInvitePayload = { sessionId: string; role: string }
type MemberAcceptPayload = { invitationId: string }
type MemberRemovePayload = { memberId: string }
type MemberChangeModelPayload = { memberId: string; provider: string; model: string; reasoningEffort?: string }
type MailSendPayload = { messageId: string; toMemberId: string; content: string; deliveryMode: 'queue' | 'steer'; taskId?: string; attemptId?: string }
type MailReadPayload = { messageId: string }
type MailConsumePayload = { messageId: string }
type QualityReportPayload = { taskId: string; attemptId: string; verdict: 'pass' | 'fail'; summary: string; evidence: EvidenceRef[] }
type TeamArchivePayload = Record<never, never>
type TeamRestorePayload = Record<never, never>
type TeamDeletePayload = Record<never, never>
```

`team.create` 的 payload 声明团队目标与初始成员计划；workspace 根取自 Host 配置，`workspaceRelativePath` 必须规范化并确认仍处于绑定根之下。`maxActiveAttempts` 首版上限为 4；`mode: 'fast'` 只跳过计划确认，不跳过质量门和人工调度。`sessionMode` 允许持久成员与临时成员混用；已有普通会话通过明确 `sessionId` 绑定，玄驹创建的成员会话由生命周期清理矩阵管理。其余动作的 `teamId` 必需。每个命名 payload 类型的字段规则由同一 Host/Client 共享的生成 schema 固定，适配器不另行定义字段语义。

`requestId` 是调用方为一次业务请求提供的稳定幂等键，dispatcher 将 `idempotencyKey` 固定设为 `requestId`，并对规范化后的 `{action, teamId, payload, expectedEventSeq}` 计算 `payloadDigest`：先按 RFC 8785 JSON Canonicalization Scheme 生成 UTF-8 字节，再计算 SHA-256。各入口必须使用同一 canonicalizer/schema version。相同 `requestId` 与相同 digest 的重放返回原提交游标和事件 ID，结果为 `duplicate`；相同 requestId 搭配不同 digest 返回 `team/duplicate-request-conflict`，不得再次写 WAL。只要创建所得 Team WAL 仍存在，`team.create` 的 duplicate receipt 必须返回首次提交生成的 `teamId`；Host 在根级 writer lease 下扫描 Team WAL，或使用可重建索引定位原始 receipt，索引不形成第二事实 owner。物理删除整个团队目录后，创建请求历史也随 WAL 一并消失；不得保留删除回执或额外身份索引来恢复它。`team.delete` 的成功响应丢失后重放按目录缺席返回 `team/not-found`。`teamId` 在 `team.create` 时缺省，在其余动作中必需；`expectedEventSeq` 用于 CAS，过期时不写新事件。

### 4.2 TeamAction

首版动作是严格判别联合；每个动作只通过 `team/dispatch` 暴露：

```text
team.create
plan.confirm
attempt.dispatch
attempt.pause
attempt.resume
attempt.takeover
attempt.terminate
attempt.retry
member.invite
member.accept
member.remove
member.changeModel
mail.send
mail.read
mail.consume
quality.report
team.archive
team.restore
team.delete
```

动作 payload 必须由同一共享 schema 生成的 strict codec 校验。字段契约如下；`?` 表示可选，未列字段一律拒绝。`PlanDraft`、`InitialMember`、`EvidenceRef` 是共享生成 schema 中的嵌套 DTO，也启用 `additionalProperties: false`。

| Action | Payload 字段 |
|---|---|
| `team.create` | `goal: string`, `workspaceRelativePath: string`, `plan: PlanDraft`, `members: InitialMember[]` |
| `plan.confirm` | `planDigest: string` |
| `attempt.dispatch` | `taskId: string`, `memberId: string` |
| `attempt.pause` / `attempt.resume` / `attempt.takeover` | `taskId: string`, `attemptId: string` |
| `attempt.terminate` | `taskId: string`, `attemptId: string`, `reason?: string` |
| `attempt.retry` | `taskId: string`, `previousAttemptId: string`, `memberId: string` |
| `member.invite` | `sessionId: string`, `role: string` |
| `member.accept` | `invitationId: string` |
| `member.remove` | `memberId: string` |
| `member.changeModel` | `memberId: string`, `provider: string`, `model: string`, `reasoningEffort?: string` |
| `mail.send` | `messageId: string`, `toMemberId: string`, `content: string`, `deliveryMode: 'queue' | 'steer'`, `taskId?: string`, `attemptId?: string` |
| `mail.read` / `mail.consume` | `messageId: string` |
| `quality.report` | `taskId: string`, `attemptId: string`, `verdict: 'pass' | 'fail'`, `summary: string`, `evidence: EvidenceRef[]` |
| `team.archive` / `team.restore` / `team.delete` | 空对象 `{}`，额外属性拒绝 |

`team.create` 的 payload 声明团队目标与初始成员计划；workspace 根取自 Host 配置，`workspaceRelativePath` 必须规范化并确认仍处于绑定根之下。其余动作的 `teamId` 必需。`team.create` 以 Host 绑定的 workspace identity 与 `requestId` 生成稳定 teamId，使相同创建重放能定位原 Team WAL，不增加第二事实索引。动作命名是逻辑类型，实际公开 wire 只有 `team/dispatch`。

### 4.3 TeamActionReceipt

```ts
type TeamActionReceipt = {
  outcome: 'committed' | 'duplicate'
  requestId: string
  teamId: string
  firstEventSeq: number
  lastEventSeq: number
  eventIds: string[]
  viewState: 'ready' | 'rebuild-required'
}
```

只有 WAL durable append 完成后才返回 `committed`。幂等键恒为 `requestId`，重复请求按规范 `payloadDigest` 比较：相同 digest 返回原提交游标与事件 ID，结果为 `duplicate`，不再次写 WAL；不同 digest 返回 `team/duplicate-request-conflict`。`team.create` 的 duplicate receipt 返回首次提交产生的 `teamId`。`team.delete` 在清理完成并移除整个团队目录后，WAL 与幂等记录一并消失；若成功回执丢失，重放相同 `requestId` 返回 `team/not-found`，调用方通过 `team/get` 或 `team/list` 确认目录缺席，不为已删除团队保留删除回执。若目录仍存在且 WAL 含 `team.delete-requested`，重放或启动恢复继续同一幂等清理流程，不把进行中的删除误报为已完成。

### 4.4 RemoteError

稳定错误码：

```text
team/not-found
team/forbidden
team/invalid-action
team/invalid-state
team/stale-cursor
team/duplicate-request-conflict
team/persistence-failed
team/lease-conflict
team/lease-lost
team/rebuild-required
team/unavailable
```

错误 details 至少带 `requestId`、`teamId`、`retryable`；CAS 冲突带当前 `eventSeq`。同一 Host action 在本地调用和 Typert Remote 上使用同一错误语义。

## 5. Team Event envelope

```ts
type TeamEventEnvelope = {
  schemaVersion: number
  eventId: string
  teamId: string
  eventSeq: number
  causationId: string
  idempotencyKey: string
  payloadDigest: string
  aggregateVersion: number
  occurredAt: string
  actor: 'user' | 'agent' | 'system'
  principal?: { kind: string }
  type: string
  payload: JsonValue
  attemptId?: string
}
```

`principal` 由可信 Remote `PeerScope` 或 Host 调用上下文填充，不由请求 JSON 提供。事件 `eventSeq` 在每个 Team WAL 内从 1 开始单调连续递增；同一 `teamId` 的动作串行化后分配下一个游标，不同团队可并行。`eventId` 在该 Team WAL 内唯一；`aggregateVersion` 与折叠状态匹配；`causationId` 连接人工动作、自动推进和派生事件；`attemptId` 绑定任务执行代次。根 lease 的 `epoch` 与 `fencingToken` 不替代 Team WAL 的 `eventSeq`，而是作为每次 append 的写入资格校验。

写入顺序固定为：

```text
trusted caller context
  -> strict action schema
  -> lifecycle/member/attempt/CAS checks
  -> root writer lease (ownerId/epoch/fencingToken)
  -> per-team serialized queue and requestId/idempotency lookup
  -> Team Event envelope (Team-local eventSeq and payloadDigest)
  -> durable WAL append with an atomic fencingToken check before bytes are committed
  -> snapshot/read-model fold
  -> TeamActionReceipt
  -> Travelling Copy update and optional team/changed notification
```

重放时拒绝重复 `eventId`、不连续 `eventSeq`、无法解析的非根 `causationId` 引用、未知 schema version 与错误 aggregate version；团队首事件的根 `causationId` 使用显式 root sentinel。损坏位置进入 `needs_attention`，不得由旧快照静默覆盖。

## 6. 调用者、权限与确认

| 调用者 | 可执行范围 |
|---|---|
| 用户 | `plan.confirm`；attempt 派发/暂停/恢复/接管/终止/重试；成员邀请/移除/换模型；归档/恢复/删除 |
| 成员/agent | 权限范围内的邮箱发送/读取/消费、质量报告、加入申请、提案、团队视图读取 |
| system/queen | 计划确认后的自动推进、质量门推进、一次自动 repair、恢复调度 |

`agent tool` 不得代替用户执行用户专属人工动作。Host `approval` 只处理宿主工具的 open-turn approval，不承担玄驹动作的通用用户授权。请求上下文中的 `surface`、`principal` 与 authority 来自受信 Host/Remote peer；调用方只能提交 action 与 payload。

## 7. 生命周期、归档与清理

### 7.1 归档与恢复

归档顺序为：

```text
archiving -> drain attempts and mailbox -> drain-complete -> archived -> move complete team directory
```

归档迁移完整 Team WAL 与派生物，不另设 archive manifest、archive WAL 或其他 owner。恢复沿用原 `teamId`、事件历史与 attempt generation，再写入恢复事实。

### 7.2 删除

`team.delete` 是用户专属动作，且只有一个清理序列：

```text
validate explicit teamId, user authority and current writer fencing
  -> append team.delete-requested with the cleanup intent
  -> idempotently clean derived files and team-created member sessions
  -> verify every declared cleanup target is absent or accounted for
  -> remove the complete team directory, including WAL and idempotency records
  -> directory absence is the deleted result
```

用户原有普通会话保留。若目录中仍有 WAL 且包含 `team.delete-requested`，启动恢复或同一请求重试继续这条序列；若清理无法自动恢复，保留目录与 WAL，团队进入 `needs_attention` 生命周期状态，动作返回稳定错误 `team/persistence-failed`，不得在未确认清理完成时报告删除成功。目录移除后不留 tombstone、删除回执或团队摘要；若成功响应丢失，之后重放相同 `requestId` 返回 `team/not-found`，而非 `duplicate`。

## 8. 四类适配器

- Web Client：只调用 `remote.team.dispatch/get/list`，只消费 `TeamView` 与失效通知，不读团队目录、不操作 DOM/iframe。
- `/ant`：解析确定性命令后调用 `TeamActionService`。
- Headless：调用同一 Host service。
- agent tool：经过工具 scope/guard 后调用同一 dispatcher，不复制业务逻辑。

四类入口共享 action schema、权限矩阵、幂等、WAL 事务、receipt 和 error code。

## 9. 验收矩阵

| 验收面 | 必须观测 |
|---|---|
| Typert 发布 | `./typert`、`./remote`、Client bundle、strict schema、exports、`team` namespace、`dispatch/get/list` endpoint 无冲突 |
| 统一动作 | Web、Headless、`/ant`、agent tool 对同一输入产生同一 receipt/error 语义 |
| 幂等与 CAS | 相同 request 重放为 `duplicate`；不同 payload 为 conflict；过期 cursor 为 stale 且 WAL 不增长 |
| Writer lease | 第二 Host 为 `team/lease-conflict`；lease 丢失后的写入拒绝；崩溃后后继 Host 可恢复 |
| WAL 与读面 | append/replay、Team-local eventSeq 连续性、eventId 唯一、causation 引用与 aggregateVersion 校验、snapshot 游标/digest/schema 检查、read-model rebuild、通知失效后 get 读回最新状态 |
| Session 适配 | `accepted`、delivery、read、consume、complete 分阶段落 WAL；model selection 下一请求生效；迁移并继续独立 |
| 生命周期 | archive drain/identity、restore history、delete 目录缺席、删除部分失败保留目录、不误删用户原有普通会话 |

## 10. 兼容边界与待实现项

目标为 DSH `0.2.1-rc.2` / Node `22.23.2`。本契约不新增 Session event type，不修改 Agent loop，不把 `sessionReferenceResolver` 当消息投递，不复用 Session 私有锁。实现阶段仍需确定并验证：

- 跨平台根级 writer lease 与异常退出恢复；
- WAL 文件协议、durability、checksum、尾记录处理、schema upgrade 与 snapshot rebuild；
- 普通 Session policy/principal、requestId 并发竞态与 cold recovery；
- queue/steer 阶段故障、archive drain、成员后代停止、删除部分失败；
- Typert 生成链、实际 Host/Client bundle 安装、真实 slot 显示和代码仓库闭环。

## 11. 决策记录与依据

本稿沿用已确认的 Team WAL owner、单 Host writer、归档整目录迁移和目录缺席删除。公开 ABI A 方案在设计审阅中确认：一个 `team/dispatch` 写入口，`team/get`/`team/list` 读入口；删除成功响应丢失后的重放返回 `team/not-found`。

依据：

- [T1 架构基线](ant-baseline.md)；
- [ADR-0001](../adr/0001-team-wal-as-canonical-owner.md)；
- [会话契约研究](../research/2026-10-31-ant-contracts-session.md)；
- [持久化研究](../research/2026-10-31-ant-persistence.md)；
- DSH `dsh-typert-protocol`、`dsh-typert-registry`、`dsh-typert-loader` 与 `dsh-api-job-controller` `0.2.1-rc.2` 的已读 Host/Client 产物。

本稿是设计输入，不是实现完成证明。

## sessionController.prompt

`prompt(request, signal)` 会在准入消息前解引用调用方 signal（Host 内 `signal.throwIfAborted()`），因此没有自有生命周期的调用方也必须传一个：`await controller.prompt(request, signal ?? new AbortController().signal)`。漏传时抛 `Cannot read properties of undefined (reading 'throwIfAborted')`，消息不会进收件箱。

## member.hatch

名册里 `sessionMode: 'ephemeral'` 的成员没有 Session 就不是可派工的成员：Team 只是名册，Session 归 Host 拥有。孵化由调度 tick 触发，不建队即触发——`runSchedule` 在评估就绪性之前调用 `service.hatchMembers({ teamId })`，因此天然受 `plan.confirmed` 门控（未确认的计划不孵任何 Session）。

流程：`sessionController.create({ cwd })`（cwd = `workspaceRoot/workspaceRelativePath`）→ 可选 `selectModel({ sessionId, provider, model, reasoningEffort })`（失败即回落到该 Session 的默认模型，不阻断孵化）→ 以 system 身份落 `member.hatch`，fold 把 `sessionId` 绑到成员并置 `status: 'active'`。system 权威要求 `planConfirmed`，所以 `member.hatch` 同时进 `scheduled` 与 `systemOnly`，成员不能自己认领。

幂等：每个 team 同时只跑一个孵化批（`state.hatching`），requestId 固定为 `hatch-<teamId>-<memberId>`；创建失败只记 `{ memberId, error }` 返回给调用方，成员保持 `requested`，下一轮 tick 自动重试。已绑定的成员不会二次孵化，因为候选集要求 `origin === 'team-created' && !sessionId`。

删除清理：孵化出的 Session 保留 `origin: 'team-created'`，`team.delete` 的会话血缘因此能把它们一并退休。
