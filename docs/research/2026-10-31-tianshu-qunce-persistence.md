# 天枢群策持久化边界研究

- 研究票：Wayfinder #12《核实 WAL、邮箱、快照与恢复的持久化边界》
- 研究日期：2026-10-31
- 调查对象：`D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router`
- 结论文件：本笔记
- 证据范围：插件源码、类型声明、仓内测试与设计资料；OpenHands、AutoGen、AG2、CrewAI 官方文档或固定提交源码
- 研究方式：只读；没有修改插件实现、HTML、规则文件，没有创建 Issue，没有提交 git

## 结论先行

1. **当前插件的团队状态事实来源是磁盘状态**：`<workspace>/<stateDir>/<teamId>/team.json` 保存 `TeamState`，`inbox/<agentKey>.jsonl` 保存邮箱；插件在一个进程内通过每团队 Promise 队列串行化读改写。`src/state.ts:4-12,57-83`。
2. **Session 事件与 `agentTeams` projection 是随会话旅行的结构副本**。它们适合审计、会话 fork/resume、第二浏览器窗口和结构恢复，不能替代磁盘状态；缺少 projection 或 plugin record 不能推出 workspace 没有团队。`src/plugin-records.ts:11-22`、`src/projection.ts:12-27`、`src/event-types.ts:224-232`。
3. **当前事件层不是完整 WAL**。插件声明 11 个事件名；payload 没有独立的事件版本、持久 sequence、causation/idempotency key 或完整状态快照。Session 自身有宿主 `seq`，但插件事件写入失败只 warning，工具继续执行。`src/event-types.ts:167-179`、`src/events.ts:41-69`、`scripts/plugin-records-tdd.mjs:70-119`。
4. **邮箱是持久 JSONL，但不是独立 append-only WAL**：发送路径读取整个文件后再原子替换；消息带投递租约、`deliveredAt`、`readAt`、`discardedAt` 与 task/attempt 来源绑定。`src/state.ts:450-480,526-635`。这让邮箱适合恢复和审计，却不能把文件偏移直接当成跨进程消费游标。
5. **attempt 是执行代际的能力令牌**。新代际生成随机 `attemptId`、清理旧证据；重分配清除旧 capability 并生成 handoff；调度器只对本进程没有观察到的持久 open attempt 做一次冷恢复，并在 dispatch 失败时按精确 `attemptId` 回滚。`src/state.ts:170-233`、`src/scheduler.ts:436-570`。
6. **归档保留完整 team 目录，永久删除才清除 archive**。结束团队会退休成员、丢弃未读旧邮件、停止成员激活、写 `team-deleted` 事件，再把 `team.json` 与 inbox 一起移动至 archive；删除 archive 是精确列举、所有权校验后的直接递归删除，无备份。`src/tools.ts:2647-2679`、`src/state.ts:992-1088`。
7. **最需要群策补强的边界**是：事件版本与幂等键、跨进程 writer/锁、邮箱 queue/delivery/read/consume 的明确状态机、递归 drain 成员后代与旧输入、归档失败重试状态、snapshot cursor 与 WAL 的绑定、永久删除前的可审计确认。

## 证据分栏：现有事实、设计建议、待验证项

| 主题 | 现有事实 | 群策设计建议 | 待验证项 |
| --- | --- | --- | --- |
| 团队真相源 | `team.json` 是 activity panel 的 authoritative source；Session/plugin record 是 travelling copy。`src/plugin-records.ts:11-22`。 | 每个团队只设一个 durable aggregate owner；快照、面板、projection 都从它或其明确事件游标派生。 | 多进程同时改同一团队时当前 process-local lock 的结果；是否需要跨进程文件锁或 SQLite writer。 |
| 事件/WAL | 11 个 `agent-teams/*` 事件；host vocabulary 走 `Session.append`，否则走 `plugin:agent-teams/*`，一次 mutation 只写一条腿。`src/event-types.ts:167-179`、`src/events.ts:11-16,41-69`。 | 事件头固定 `schemaVersion/eventSeq/eventId/causationId/idempotencyKey/aggregateVersion`；提交顺序写 WAL → 更新 snapshot，或明确 snapshot → WAL 的恢复规则。 | Host Session `seq` 与 durable team mutation 的原子关系；append 失败后的补偿、丢失事件审计；Session migration 对 plugin record 的实际保留率。 |
| Projection | `agentTeams` 只折叠结构；`stateVersion: 1`；`revision` 只在可见结构改变时递增，重复/未知/amendment 可保持同一对象。`src/event-types.ts:182-237`、`scripts/projection-tdd.mjs:34-191`。 | projection 带 `projectionVersion` 与 `lastEventSeq`；把“结构摘要”“activity snapshot”“archive index”明确分开。 | 宿主 registry 在不同 DSH 版本中的 stateVersion 迁移；重复事件与跨 fork 的 seq 对齐。 |
| Snapshot | live snapshot 读 durable state 并合并 live member activity；historic snapshot 清空 live activity、保留 removed members 和 unread mailbox。`src/snapshot.ts:142-253,290-321`。 | 每个 snapshot 记录 source event cursor、state schema、createdAt、team generation；恢复时先校验 cursor 与 aggregate version。 | 当前 snapshot 是否能与一次具体 event fold 完整对齐；state 写入与 snapshot 读取之间的竞态。 |
| 成员与任务 | member 的 route/model/persona/fallback 等 durable 字段写入 team state；task 的 status、attempt、attemptId、handoffId 和 evidence 受状态机约束。`src/state.ts:143-233`；类型定义在 `src/types.ts`。 | 用 `memberId + taskId + attempt` 组成执行代际键；所有 completion/evidence/message 都携带 generation。 | 冷恢复时宿主 AgentHandle、子孙激活、后台 settlement 的真实生命周期；是否存在外部副作用已发生而 task 未落盘的窗口。 |
| 邮箱 | 邮件按 recipient 写 JSONL；pending 与 delivered-but-unread 分离；current-generation 检查拒绝 discarded、旧 source attempt 或旧 recipient attempt。`src/state.ts:450-635`、`src/mailbox.ts:11-45`。 | 明确 `queued → claimed → delivered → read → consumed` 与 `discarded` 状态；receipt 使用稳定 message id，消费端维护幂等 ledger。 | `acknowledgeMailbox` 当前同时设置 `deliveredAt/readAt`，而 `markMailboxDelivered` 分离两者；宿主 queue、step admission、模型真正消费三者尚未用真实 Loader E2E 对齐。 |
| 归档/恢复 | archive 是整个 live team 目录的移动；historic route 从 archive 读取并保留 removed members。`src/state.ts:992-1050`、`src/snapshot.ts:298-321`。 | 归档前持久化 `stopping/retired/drain-complete` 阶段；archive manifest 写入 generation、last event cursor、mailbox counts；恢复只读或显式创建新 generation。 | 直接成员、子孙成员、旧队列和内部 completion wakeup 的递归 drain；归档期间新消息、settlement 与 archive rename 的竞态。 |
| 永久删除 | `deleteArchivedTeam` 先列举精确 id，再 `rm` archive；重复返回 false，路径样式 id 不产生副作用。路由先认证、再按 archived `captainSessionId` 校验所有权。`src/state.ts:1072-1088`、`scripts/archive-delete.test.mjs:164-294`。 | 删除前记录 tombstone/删除审计或外部审计引用；按 team generation 清理 archive、mailbox、retired-member index、client cache 的关系。 | 用户要求的“永久删除”是否还需同步清理 Session travelling copy、host archive index、隐藏 previous 目录和外部日志；当前代码只删除 archive 目录。 |
| 客户端缓存 | activity monitor 保留最后成功快照；归档删除只先 prune 本地视图，轮询再与 host authoritative list 对账；live 1s、cold discovery 5s。`src/client/activity-monitor.ts:197-257,260-329,331-415`。 | client cache 只作可丢弃派生缓存，记录 source revision/cursor；删除响应失败时保留旧 row 并重试。 | host restart、archive route 失败、网络重试和删除后旧 session projection 同时存在时的最终一致时间。 |

## 一、团队状态与持久化对象边界

### 1. `team.json` 是团队 aggregate 的当前状态

插件源码在文件头直接声明目录布局：`<workspace>/<stateDir>/<teamId>/team.json` 是 durable `TeamState`，`inbox/<agentKey>.jsonl` 是每个 agent 的 JSONL 邮箱；所有 mutation 走进程内 per-team queue，底层直接用 `fs/promises`。`src/state.ts:4-12`。

`withTeamLock` 以 Promise chain 串行化同一 key 的读改写，并在 tail 结算后移除 lock entry；这是**单进程串行**，不是跨进程锁。`src/state.ts:57-83`。仓内使用资料也明确：文件持久化在同一进程内串行，跨进程同时写不保证一致；面板读取磁盘，而事件流独立。`docs/usage.md:144-154`。

`readTeam` 只在 `ENOENT` 时返回 `undefined`；JSON 损坏或 state shape 不合法会抛出 `invalid AgentTeams state in team "<teamId>": ...`。`src/state.ts:246-265`。这条边界很重要：缺目录可表示团队已不存在，损坏文件表示“存在但不可读”，后续恢复与面板应保留诊断，而非把两者合并成空团队。

`createTeamDir` 创建 `inbox` 并用 `atomicWriteText` 写初始 `team.json`。`src/state.ts:235-244`。状态写入的原子替换策略包含同目录临时文件、三次 50ms rename 重试和 direct-write fallback；邮箱和 team state 共用这套 replacement helper。`src/state.ts:642-747`。

### 2. Session log 是 travelling copy 与审计面

每次 team mutation 由 `appendTeamEvent` 尝试写 captain Session；若宿主已经注册 `agent-teams/*`，用 `session.append`，否则用 `appendTeamRecord` 写 `plugin:agent-teams/*`。两条 leg 严格互斥，一次 mutation 不重复写。`src/events.ts:11-16,41-69`。

事件记录的主要价值是随 fork/resume 携带、供 Conversation Node 确定性 fold、供结构审计和第二浏览器窗口使用。`src/plugin-records.ts:1-10`、`docs/developing-dsh-plugins.md:253-274`。但 plugin record surface 是 experimental，Session format migration 只 best-effort 保留；缺 record 只能解释为没有 travelling copy，不能解释为团队不存在。`src/plugin-records.ts:16-22`。

事件失败只记录 warning，不阻止团队工具执行。`src/events.ts:34-69`。因此当前系统允许出现“磁盘 mutation 已成功、Session event 缺失”的事实组合；研究笔记与群策状态机不能把 Session log 当磁盘状态的提交确认。

### 3. `agentTeams` projection 只折叠结构

Projection 的注释把边界写得很清楚：它是 structural summary，不是 activity snapshot；member execution state、unread counts、queue reasons、route audits、archive listing 在 host/disk，不能从 log fold 出来。`src/projection.ts:12-22`。

Projection member 只有 `id/name/role/status`；task 只有结构、status、assignee、round、verdict、attempt 等摘要；message 只保存 message count，正文留在 mailbox。`src/event-types.ts:182-222`。所以以下内容不能从 projection 恢复：完整 attempt evidence、`output`、`findings`、commands、changed paths、delivery lease、read/discard timestamps、live activity、队列原因、archive listing。

`revision` 的语义是每条真正改变 team 的 log record 加一；无 agent-teams record 的 log 得到 `revision: 0` 和空 team list，但这只说明“该 log 没有团队”，不说明 workspace 没有团队。`src/event-types.ts:224-237`。测试进一步固定了空 log、member/task/message fold、removed member 历史行、重复 lifecycle、未知成员/任务/事件不改变 identity、两种 event writer leg 等行为。`scripts/projection-tdd.mjs:34-142`。

Projection registry 的 contract 是 key `agentTeams`、`stateVersion: 1`，wire view 是 whole value，客户端替换整个 projection，而非应用 delta。`scripts/projection-tdd.mjs:144-178`。这是一种结构投影版本，不是 team state schema version，也不是 WAL event version，三者应在群策设计中分开命名。

## 二、事件、WAL、版本与幂等

### 当前事件目录

`AgentTeamsEventType` 只有 11 个类型：team-created、member-added、member-removed、task-created、task-updated、task-amended、message-sent、team-halted、team-resumed、team-deleted、plan-discarded。`src/event-types.ts:167-179`。

payload 主要表达结构变化与可见摘要。`task-amended` 只记录 contract fields/reason；projection 明确不把 amendment 写进 summary。`src/projection.ts:141-149,194-280`。完整状态仍在 team.json。

### 当前系统有哪些“序号”

- Host Session log 自带宿主事件 `seq`；plugin-record 测试验证 append 返回值等于 committed log record 的 `seq`。`scripts/plugin-records-tdd.mjs:70-83`。
- `agentTeams` projection 有 `revision`，只用于判断结构 value 是否发生变化。`src/event-types.ts:224-237`。
- Projection registry 有 `stateVersion: 1`。`scripts/projection-tdd.mjs:157-161`。
- Team task 有 `attempt` 数字和随机 `attemptId`；它们是执行代际，不是全局事件序号。`src/state.ts:187-203`。

当前 plugin payload 没有独立的 `eventVersion`/`schemaVersion`/`eventId`/`causationId`/`idempotencyKey`/`aggregateVersion`。因此“Session seq + projection revision + task attempt”不能合并称为一个 WAL 游标。

### 建议的群策事件合同

这是设计建议，不是插件现状：

```json
{
  "eventId": "uuid",
  "eventType": "team.task.updated",
  "schemaVersion": 1,
  "aggregateId": "team-id",
  "aggregateVersion": 42,
  "eventSeq": 42,
  "causationId": "parent-event-id",
  "correlationId": "run-id",
  "idempotencyKey": "tool-call-or-command-id",
  "occurredAt": 1793428800000,
  "payload": {}
}
```

建议把 `eventSeq` 绑定到**团队 aggregate**，把宿主 Session `seq` 作为外部观察坐标；投影保存 `lastEventSeq` 与 `lastSessionSeq`（若有），snapshot 保存 `lastEventSeq`、`stateSchemaVersion` 和 checksum。重放器按 `(aggregateId,eventSeq)` 检查连续性；重复 `eventId` 或已处理 `idempotencyKey` 直接返回既有结果；缺口、重复冲突和 schema 不兼容进入诊断状态，不静默折叠成空团队。

建议明确一次 mutation 的提交顺序。例如：

1. 在团队 lock 或跨进程 writer lock 内读取当前 state/version。
2. 校验 idempotency key；已提交则返回原 receipt。
3. 构造事件并追加 WAL，成功后得到 durable eventSeq。
4. 应用事件更新 snapshot/team.json，写入 `lastEventSeq`。
5. 发布 Session travelling record；发布失败进入 outbox/retry，不回滚已提交团队状态。

当前插件没有这套 WAL/outbox 闭环；因此上面只应作为群策方案验收基线。

## 三、成员、任务、attempt 与证据

任务状态转换在 `src/state.ts:143-154`：`pending → claimed/cancelled`，`claimed → in_progress/failed/cancelled`，`in_progress → completed/failed/cancelled`；terminal status 没有后继状态。

`activateTaskAttempt` 每次生成随机 `attemptId`、设置 assignee、清除 handoff 与旧结果，并把任务置为 `claimed`；`beginTaskAttempt` 先递增 `attempt` 再激活。`src/state.ts:170-203`。`clearAttemptResult` 清除 output、verdict、findings、changedPaths、acceptanceResults、commandsRun、evidenceAttemptId、reviewed* 与 verdictStartSnapshot。旧代际证据不能随新代际继续使用。

`invalidateTaskAttempt` 清除 attempt capability，生成新的 `handoffId`，把任务回到 pending，可设置下一 assignee，并清除结果。`cancelUnfinishedTask` 则直接进入 cancelled、清除 attemptId/handoffId。`src/state.ts:206-233`。

调度器每轮在 lock 内重新读取 TeamState；halted/staged、removed member 和 unavailable member 不派发。对一个持久 open task，只有当当前进程没有观察到该 attempt 时才做一次 cold recovery；recovery 先把精确 `(member,attempt)` 放入 `parkedAttempts`，再写 durable state 和 dispatch。`src/scheduler.ts:436-527`。

dispatch 被拒绝时，只有 task 仍匹配此次 ticket 的 exact `attemptId` 才回滚；recovered generation 恢复旧 generation 与 evidence，fresh pending work 返回 pending。并发 handoff 已改变 capability 时，当前失败 dispatch 不覆盖新拥有者。`src/scheduler.ts:542-570`。

这组逻辑已经提供了“旧 attempt 更新不能穿透”的基础，但它保护的是插件自己的 durable task/evidence 字段；外部工具副作用、模型请求和宿主 queue 是否已发生，仍需运行时证据。

## 四、邮箱、投递、读取、消费与幂等

### 当前持久化格式

`createMessage` 为消息生成 UUID、from、to、content、ts。`appendMailbox` 按 sanitized recipient key 定位 `<team>/inbox/<agent>.jsonl`，读当前全文、追加换行和 JSON 行，再用 atomic replacement 写回。`src/state.ts:450-480`。这不是数据库式 append syscall，也没有返回 byte offset，因此不能把文件末尾位置直接当可靠消费游标。

`readMailbox` 按旧到新解析，空文件/缺文件返回空数组；坏行通过 callback 诊断并跳过，其余有效行仍可读。`src/state.ts:482-524`。`readUnreadMailbox` 过滤 `readAt` 和 `discardedAt`，`readPendingMailbox` 进一步要求未 delivered 且 delivery lease 不存在或已经超过 60 秒。`src/state.ts:526-544`。

邮箱 mutation 会保持坏行，并对选定有效消息原子改写。`claimMailboxDelivery` 写 lease，`releaseMailboxDelivery` 清 lease，`acknowledgeMailbox` 同时写 `deliveredAt` 与 `readAt`，`markMailboxDelivered` 只写 `deliveredAt`，`discardMailboxMessages` 写 `discardedAt`。`src/state.ts:546-635`。

### 当前代际过滤

`isCurrentMail` 先拒绝 discarded message；若有 `sourceAttemptId`，要求 source task、source attempt、source assignee 仍匹配，并在 source terminal status 已知时匹配 terminal status；若有 recipient `attemptId`，要求 recipient task/attempt/assignee 仍匹配且 task 处于 claimed 或 in_progress。`src/mailbox.ts:11-19`。

`readCurrentMailbox` 在 team lock 内读取未读 mail，先 discard obsolete records，再返回 current records。`src/mailbox.ts:33-41`。step admission 解析 receipt，按 recipient 每步只做一次读取/ack；current mail 被确认后才注入模型输入，旧 mail 被 discard。读失败时该 batch 保持 unacked，receipt 原样 pass-through，宿主不会因某个坏 team.json 被卡住。`src/mailbox.ts:62-174`。

这里有一个需要在群策中固定的语义核对：当前 `acknowledgeMailbox` 把“已进入 admission”与 `readAt` 同时落盘，而 `markMailboxDelivered` 才提供 delivery/read 分离的低层操作。仓内延迟审计曾指出 `readAt` 只能代表进入宿主队列时会过早，需区分持久化、入队、投递、消费、完成。`docs/session-latency-audit-2026-09-12/README.md:61-67`。因此设计验收应单独记录 `queuedAt/deliveredAt/readAt/consumedAt/completedAt`；当前源码是否已经由所有 host path 正确使用这些阶段，仍需真实 Loader E2E。

重复 receipt 的最小幂等要求是：同一 message id 在同一 recipient/attempt 下最多注入一次；第二次 receipt 只能返回空输入或既有消费 receipt。当前 admission 会在 `readAt` 已存在时从 current batch 排除，但没有独立的消费结果 ledger；这属于设计待验证项。

## 五、快照、投影、重放与恢复

### 快照边界

`assembleTeamSnapshot` 以 durable TeamState 的 tasks/members 为基础。live 模式通过 `memberActivity` 合并 running/idle/ready；historic 模式使用空 activity map，并把 activity 显示成 idle；每个成员和 captain 都读取 unread mailbox；messageCount 是 captain 与成员 unread 数量之和，captainInbox 只返回最后 5 条。`src/snapshot.ts:142-253`。

live scan 遍历 state root 的团队目录，单个 unreadable team 会 warning 并跳过。archive scan 从 `archive/<teamId>` 读状态，以 `includeRemoved: true, historic: true` 组装历史快照，所以 removed member 保留，live activity 不再宣称。`src/snapshot.ts:255-321`。

snapshot 是 activity/read model，不是事件 WAL；它也不包含完整历史邮箱正文，只提供 unread 计数和 captain 最近 5 条展示。归档目录本身保留完整 `team.json` 与 inbox，因而历史查看比 projection 完整。

### 重放边界

Projection fold 对 plugin/in-vocabulary 两个 writer leg 给出相同结构；重复 team-created 会刷新 header、保留已有 member/task delta 且不产生第二个 team；重复 lifecycle 不递增 revision；未知 team/task、amendment、无 teamId 和其他 plugin event 被跳过。`scripts/projection-tdd.mjs:104-142`。

这证明的是**结构 projection 的确定性与有限幂等**，不是完整 TeamState event-sourcing。`team.json` 中的 route audit、attempt evidence、mailbox delivery/read 状态、live process state 和 archive index 不由该 fold 重建。

插件开发资料将数据链写成“工具执行 → 磁盘状态 → host snapshot route → 客户端轮询”，Session log 用于审计、重放、复盘。`docs/usage.md:7-20`。浏览器 activity monitor 的 live route cadence 是 1s，cold discovery 是 5s；projection 改变可 kick 当前 poll；host 重启时保留最后成功快照，下一 tick 重试；archive delete 的本地 prune 只是 client view，host list 才是 authoritative list。`src/client/activity-monitor.ts:197-257,260-329,331-415`。

### 恢复边界

冷恢复可恢复 durable team/member/task/mailbox，但不能仅凭 projection 推回完整 runtime execution。队长离线时插件只能用调用者 Session 作为 event record fallback，不能据此重建 captain live member processes。`src/events.ts:72-88`；`docs/usage.md:144-154`。

当前 scheduler 对一次未被本进程观察到的 open attempt 允许一次 exact-generation recovery；它不凭空轮换一个本进程已 park 的 disposed handle。`src/scheduler.ts:443-490`。这是防止重启或状态 poll 反复生成 attempt 的本地规则，不是跨机器 exactly-once 证明。

## 六、归档、恢复与永久删除

### 1. 正常结束团队

`team-delete` 工具在 lock 内重新读取团队，将所有成员（包含此前 removed 的 durable row）纳入退休目录；清理成员 unread mail；将仍未完成 task 的 assignee attempt invalidate；写 team state；把成员 id 写入 `retired-members.json`；停止成员 activations；重新读取 fresh state，写 `team-deleted` event，然后 archive。`src/tools.ts:2647-2679`。

注释明确 archive 而非 delete：tasks、dependency graph、mailboxes 留在磁盘供后续 review 与 dependency rebuild。`src/tools.ts:2675-2677`。

### 2. staged plan discard

staged plan 没有 child sessions；discard 先写 `plan-discarded`，archive whole directory，之后给 captain 注入控制事实并 cancel 当前 turn，避免晚到的 model step 看到 active team 缺失后重新创建。`src/tools.ts:851-880`。

### 3. archive move 与历史读

`archiveTeamDir` 创建 archive root，将旧 archive 移到隐藏 `.<teamId>.previous-<uuid>`，把 live dir rename 到 archive；若新 move 失败会尝试恢复 previous；新 archive 成功后 best-effort 删除 hidden previous，清理失败只留下 discovery 忽略的隐藏 recovery dir。`src/state.ts:992-1041`。

`listArchivedTeamIds` 只返回 archive 下非隐藏目录，缺 root 返回空；`readArchivedTeam` 复用 `readTeam`。`src/state.ts:1043-1069`。这意味着 hidden previous 对历史面板不可见，但在清理失败时仍是残留目录，当前代码没有独立恢复清单或重试任务。

### 4. 永久删除

`deleteArchivedTeam` 先获取 archive id 列表，只有 exact id 在列表中才构造路径并递归 `rm`；不存在时返回 false，重复删除幂等。`src/state.ts:1072-1088`。离线 route tests 固定了：认证先于 handler 工作、非 POST 为 405、坏 body/缺字段为 400、错误 captain 所有权为 404 且 archive 保留、正确 owner 为 200、删除异常为 500 且 archive 保留、路径样式 id 不能触及 live sibling。`scripts/archive-delete.test.mjs:84-294`。

永久删除当前直接清除 archive 目录；源码没有同时清理 Session travelling copy、宿主事件日志、retired-members index、外部 trace 或用户自定义 workspace artifacts。群策若把“永久删除”定义为全域 erasure，必须新增清理清单和独立验收；若定义为“archive filesystem removal”，应在接口命名与文档中明确。

## 七、清理矩阵

| 对象 | 正常结束 | staged discard | 历史查看/恢复 | 永久删除 | 当前证据与边界 |
| --- | --- | --- | --- | --- | --- |
| live `<stateRoot>/<teamId>/team.json` | rename 至 archive | rename 至 archive | live 不再存在，读 archive | 不适用；若直接调用 `removeTeamDir` 则递归删除 | `archiveTeamDir` 保留完整目录；`removeTeamDir` 是低层 force rm，调用者需先中断成员。`src/state.ts:959-966,992-1041` |
| live `inbox/*.jsonl` | 与 team 目录一起移动 | 与 team 目录一起移动 | 从 archive root 读取 | 与 archive 一起删除 | mailbox 正文在文件中，projection 只有 messageCount。 |
| task dependency/evidence | 保留在 archive | 保留 rejected graph | historic snapshot 展示结构，archive state 保留完整字段 | 随 archive 删除 | Session projection 不含完整 evidence。 |
| active member process/activation | 退休、stop activations | staged 无 child；cancel captain turn | historic 不声明 live activity | archive deletion 不负责 runtime stop | 归档前递归 drain 后代仍需真实 E2E，仓内审计记录过旧队列/孙级唤醒边界。 |
| member status/removed rows | 标 removed；archive historic includeRemoved | 无 child，state 保留 | removed rows 保留 | 随 archive 删除；retired index 是否同步清理未实现 | `src/tools.ts:2654-2669`、`src/snapshot.ts:298-314`。 |
| `retired-members.json` | union member IDs，跨 team root 保存 | 通常不新增 child id | 仍可作为 deny-list | 当前 deleteArchivedTeam 不清理 | 这是永久删除清理缺口，需群策定义引用计数或 tombstone 保留期。 |
| Session `agent-teams/*` / `plugin:*` | append `team-deleted`，但 append failure 只 warning | append `plan-discarded` | fork/resume 可携带 travelling copy | 当前 archive delete 不触及 session log | missing event 不等于 missing team。 |
| `agentTeams` projection | phase/deleted 结构记录 | discarded phase | 只能恢复 session log 结构 | 客户端可能保留到下一 poll | projection stateVersion 1、revision 是派生值。 |
| host live snapshot | live scan | live row 消失后 archive scan | archive snapshot historic | host list 去掉删除项 | snapshot store 保留最后成功值，失败时旧值继续显示。 |
| client activity cache | 继续显示 live/archive | archive row 由下一 poll 纠正 | historic row 展示 | `pruneArchivedTeamLocally` 先删本地 row，失败则保留并重试 | 本地 prune 不是 durable deletion。 |
| hidden `.previous-*` | 新 archive 成功后 best-effort rm | 同上 | discovery 忽略 | 当前 delete 仅按可见 team id 删除，不触及 hidden leftovers | 需增加清理/recovery audit。 |
| external workspace artifacts / provider side effects | 不由 archive 管理 | 不由 archive 管理 | archive 不重放外部副作用 | 当前未删除 | 需由群策明确 artifacts owner 与 side-effect ledger。 |

## 八、外部一手资料的可迁移启示

以下材料只作为设计参照，不是当前插件实现事实。

### OpenHands

OpenHands 官方持久化指南：<https://docs.openhands.dev/sdk/guides/convo-persistence>。该指南说明 conversation 使用稳定 id 与 `persistence_dir` 自动保存并可在另一 session 以同 id 恢复；持久内容覆盖 message/event history、agent config、execution state、tool outputs、stats、workspace context、skills/secrets/custom agent state；目录示意包含 `base_state.json` 与逐事件文件 `events/event-00000-<event-id>.json`。

OpenHands SDK/Agent Server 固定提交源码可定位到：

- `event_service.py`：<https://raw.githubusercontent.com/OpenHands/software-agent-sdk/c048a1eb82353b0586f3ce600708394a68ebb246/openhands-agent-server/openhands/agent_server/event_service.py>，`EventService.for_persisted_events` 使用 append-only EventLog；读取注释将已写 event 视为 immutable；`save_meta` 使用 atomic text write；goal loop 从最后持久化 goal-status event 恢复。
- `conversation_service.py`：<https://raw.githubusercontent.com/OpenHands/software-agent-sdk/c048a1eb82353b0586f3ce600708394a68ebb246/openhands-agent-server/openhands/agent_server/conversation_service.py>，启动先加载轻量 metadata，需要运行时才 hydrate history；idle eviction 关闭 live service 但保留 catalog，后续 rehydrate。
- `conversation_router.py`：<https://raw.githubusercontent.com/OpenHands/software-agent-sdk/c048a1eb82353b0586f3ce600708394a68ebb246/openhands-agent-server/openhands/agent_server/conversation_router.py>，fork deep-copy event history，navigate 保留所有 branch，delete conversation 是永久删除，pause 后可 resume。

可迁移点：snapshot/catalog 与 append-only event history 应分层；fork/branch 需要明确复制哪一代 event cursor；保存成功与 run admission 分开。OpenHands `send_message` 已保存而 run 返回 429 时调用方应 retry run，而非重复发送 message；这展示了“消息持久化”和“执行接纳”分开，但没有给出任意外部副作用 exactly-once ledger。

### Microsoft AutoGen

官方状态教程：<https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/state.html>。Agent/team 有 `save_state()` 和 `load_state()`；示例状态含 `type` 与 `version: "1.0.0"`，team 状态覆盖 manager 与 agent state，可 JSON 序列化后重建 team。

该材料支持群策建议：snapshot schema version 必须显式，恢复要调用 load_state，不能把 reset 或重新构造对象当恢复完成。

微软旧仓库 README 已标 archived/no longer maintained：<https://raw.githubusercontent.com/microsoft/autogen/main/README.md>。旧运行时源码只作为历史边界：`_single_threaded_agent_runtime.py` 的 save/load 只覆盖已实例化 agent、明确不包含 subscriptions；stop 会完成当前消息、丢弃队列并重置内存 Queue。它不能代表当前 AG2 v1。

### AG2

AG2 resume 文档：<https://docs.ag2.ai/docs/user-guide/resume/>。`agent.resume(*events)` 需要完整 trajectory；最后事件作为 trigger，其余作为 history；resume 会替换目标 stream history，持久 stream backing store 也会被覆盖；provider-native metadata 必须原样保留，否则恢复可能被 provider 拒绝。

AG2 Knowledge Store：<https://docs.ag2.ai/docs/user-guide/advanced/knowledge_store/>。协议中的 `append` 返回 byte offset，`read_range` 可读取新追加的 UTF-8 slice，支持 WAL-style workload；`EventLogWriter` 把 stream events 写入 `/log/{stream_id}.jsonl` 并加载 typed events，无法反序列化的类型回为 `UnknownEvent`；`LockedKnowledgeStore` 只对 write/delete/append 获取用户提供的分布式锁。

AG2 固定提交的网络 WAL/重放源码：

- `hub_client.py:L302-L331`：<https://github.com/ag2ai/ag2/blob/7430f438b3f283e491fab24b69c4dd78a3471332/ag2/network/client/hub_client.py#L302-L331>，接收异常发送 nack receipt。
- `hub/core.py:L2960-L3005`：<https://github.com/ag2ai/ag2/blob/7430f438b3f283e491fab24b69c4dd78a3471332/ag2/network/hub/core.py#L2960-L3005>，ack 前移并持久化 cursor，nack 只记录。
- `hub/core.py:L3015-L3057`：同文件，重连按 channel 从 WAL 顺序 replay 至 high-water。
- `hub/core.py:L3059-L3084`：同文件，按 causation 索引查询已记录回复，重复触发可跳过。
- `agent_client.py:L142-L172`：同固定提交，`resume_pending_turns` 从 WAL 取 triggering envelope 并重新 receive；属于待处理 turn 恢复，不是全计算回放。

可迁移点：WAL cursor、nack/replay、causation 去重必须标定适用范围；已记录的 network handler 可重放，不代表任意外部 tool side effect exactly-once。

AG2 ADR 0010：<https://raw.githubusercontent.com/ag2ai/ag2/main/docs/adr/0010-network-tracing-bounded-traces-and-wal-traceparent.md>。文档描述 network channel state 在 `hydrate()` 中重新 fold WAL，traceparent 在追加 WAL 前注入，WAL 是 traceparent source of truth，hydrate replay 不重新发送 spans。ADR 0019：<https://raw.githubusercontent.com/ag2ai/ag2/main/docs/adr/0019-live-session-input-flows-through-the-stream.md>，live input、audio、tool result 统一为 stream events；`enqueue` 追加后由后台 task 发布，漏订阅可能静默丢 pushed input，并未承诺 exactly-once。

### CrewAI

CrewAI 官方 checkpoint 文档：<https://docs.crewai.com/v1.15.33/en/concepts/checkpointing>；固定 main tree `97bbfb64811775a965304bda45c8ec0e8e4ef3a2` 的源码前缀为：<https://raw.githubusercontent.com/crewAIInc/crewAI/97bbfb64811775a965304bda45c8ec0e8e4ef3a2/>。

固定源码锚点：

- `lib/crewai/src/crewai/flow/runtime.py:L190-L213` 序列化/反序列化 RuntimeState；`L286-L350` checkpoint；`L352+` fork；`L391+` from_checkpoint。
- `lib/crewai/src/crewai/flow/checkpoint_listener.py:L113-L194` 按事件写完整状态并 prune；`L229-L252` replay 上下文保护与同步 handler。
- `lib/crewai/src/crewai/flow/persistence/state/provider/sqlite_provider.py:L59-L85` 开 SQLite WAL 后 INSERT JSON blob，`L87-L166` 读、prune、恢复。这里的 SQLite WAL 是存储日志，不是事件流 WAL。
- `lib/crewai/src/crewai/events/event_bus.py:L673-L732` 的 events bus replay 重新分发原事件、保持 event id/emission sequence、不重新记录；`is_replaying()` 供有副作用 listener 自行跳过。它不会重新执行 Crew/task，也不替自定义 listener 建立外部副作用幂等。
- `lib/crewai/src/crewai/crew.py:L2109-L2166` 的 `Crew.replay(task_id, inputs)` 是 task-level/latest-kickoff replay；官方说明：<https://docs.crewai.com/v1.15.33/en/learn/replay-tasks-from-latest-crew-kickoff>。
- `flow/runtime/__init__.py:L2327-L2345` 注释明确 `kickoff(inputs={'id': ...})` 是 pure state reload；`L2386-L2400` 只 load/restore user state，`L1939-L1965` 只更新 user state；checkpoint 另存 `checkpoint_completed_methods`，恢复时跳过已完成方法。故 `@persist` state reload 与 checkpoint execution resume 必须分开。

CrewAI 官方资料显示 checkpoint 可保存完整 RuntimeState、任务进度、intermediate outputs、inputs、event history 和 lineage；JSON 每 checkpoint 一个文件，SQLite provider 一个数据库，`max_checkpoints` prune oldest；fork 创建新 lineage。当前官方资料未找到 archive/export API，也未给出外部副作用 exactly-once ledger。JSON provider 的 crash-atomic temp+rename/fsync 语义不能由 checkpoint 文档推断。

## 九、最小重放与恢复验收场景

每个场景都应使用临时 workspace/state root，测试完成后在 `finally` 中清理；验收同时读取文件、Session log、projection 和 activity route，不能只看工具返回值。

### 场景 1：创建、写入、fold 一致性

1. 创建 team、member、task、message。
2. 读取 `team.json`、member/captain JSONL 和 Session log。
3. 用两个 writer leg 分别 fold 同一 mutation sequence。
4. 断言 team.json 的 task/member/message 结构存在；两种 fold 结构相同；revision 等于真正改变 projection 的记录数；空/缺 projection 不否定磁盘团队。
5. 追加同一 team-created，断言只保留一个 team、header 更新、后续 delta 保留。

覆盖：状态真相、事件副本、projection 重放幂等。对应测试基线：`scripts/projection-tdd.mjs:118-142`。

### 场景 2：attempt A 重分配至 B

1. task 在 attempt A 下 claimed/in_progress，写入 A 的 source/recipient attempt-bound message。
2. handoff 清除 A `attemptId`、生成 handoffId、清 evidence，分配 B 并生成新 attemptId。
3. 读取 A/B mailbox，assert A message 被 `isCurrentMail` 判旧，且 obsolete message 有 `discardedAt`；B 只接受新 generation。
4. 对同一 receipt 重放两次，第二次不产生第二份模型输入或第二条消费结果。

覆盖：旧 generation 隔离、消息代际幂等。若第二次仍能进入模型，记录为缺少消费 ledger。

### 场景 3：accepted、delivered、read、consumed 分离

1. 创建一条 message，确认初始 queued/pending。
2. 只执行 delivery acceptance，断言 `deliveredAt` 与 `readAt` 的关系符合合同。
3. 只执行 step admission，断言 mailbox 字段与宿主 pending input 分别可观测。
4. 模型实际消费后写 `consumedAt`，重复 receipt 不重复消费。
5. 当前插件需特别记录 `acknowledgeMailbox` 同时写 delivered/read 的实际结果；该结果若与群策合同不符，应作为实现差距，而非改写研究结论。

覆盖：邮箱阶段、宿主队列与持久 unread 的边界。对应资料：`src/state.ts:526-635`、`docs/session-latency-audit-2026-09-12/README.md:61-67`。

### 场景 4：进程重启与一次 cold recovery

1. 将 member/task 持久化为 open attempt A，保留 evidenceAttemptId=A。
2. 结束进程并重启，恢复 TeamState、member route/persona/fallback、task attempt、mailbox。
3. scheduler 对未被新进程观察的 exact open attempt 只生成一次 B；B 清除旧 evidence 或按 recovery failure 恢复原 A，不能无限生成 C/D。
4. 旧 A 更新应被拒绝或视为 stale；B 的 completion 必须携 B attemptId。

覆盖：冷恢复、旧证据隔离、attempt park。对应源码：`src/scheduler.ts:443-570`。

### 场景 5：归档运行队伍与后代激活

1. 建 direct member、孙级 member、兄弟 member，分别制造旧 queued mail、pending input、settlement 和 internal completion wakeup。
2. 结束团队，先观察 stopping/retired、任务 invalidate、mail discard、activation drain，再 archive rename。
3. 断言 direct 与 descendants 都被 drain；旧输入不再触发新 step；settlement 不唤醒 retired member；无关 sibling team 继续。
4. archive historic snapshot 保留 removed members、tasks、dependency graph 与 inbox，activity 显示 historic idle。

覆盖：归档顺序和清理深度。仓内审计明确此组真实 Loader/GUI E2E 仍未覆盖：`docs/session-latency-audit-2026-09-12/README.md:69-81,109-116`。

### 场景 6：永久删除的所有权、幂等与失败

1. 建两个 archive 与一个 live sibling。
2. 未认证请求先断言 401，错误 method 405，坏 body/缺字段 400。
3. 错 captain 得 404 且 archive 不变；正确 captain 得 200 且 exact archive 消失。
4. 第二次删除返回 false；`../live-team`、`team-a/..` 等输入返回 404/false，不影响 live sibling/其他 archive。
5. 模拟 rm 抛错，断言 500、原 archive 保留。

覆盖：不可逆删除前的边界与无副作用失败。对应测试：`scripts/archive-delete.test.mjs:36-82,164-294`。

### 场景 7：跨进程竞争与事件缺口

1. 两个独立 Node processes 同时读改同一 team.json 和同一 inbox JSONL。
2. 记录丢写、last-writer-wins、JSON 损坏、邮箱重复/覆盖、Session event 顺序。
3. 以当前插件的真实结果标记“process-local lock only”；若群策要求多进程一致性，则要求 durable writer lock、monotonic aggregate version、WAL append、recovery scan 和冲突诊断全部通过。
4. 单独模拟 Session append 失败，断言工具 mutation 仍成功，并记录“磁盘真相已提交、travelling event 缺失”的可观察组合。

覆盖：当前明确已知边界与未来多进程方案的最小 falsification。

## 十、现有事实与设计建议的最终分界

### 已由当前插件源码/测试确认

- `team.json` 与 `inbox/*.jsonl` 的目录布局和 atomic replacement。
- 单进程 per-team Promise lock；跨进程一致性未提供。
- 11 个事件类型、两种互斥 writer leg、Session `seq` 的宿主来源、plugin record 的 ignorable/frozen 形态。
- `agentTeams` structural projection、`stateVersion: 1`、revision/whole-value wire view、有限 replay 幂等。
- task transition、attempt/attemptId/handoffId、evidence clearing、scheduler exact-generation cold recovery。
- mailbox pending/unread/delivery lease/current-generation filtering、discard audit retention、坏行跳过。
- live/historic snapshot 的 activity 与 removed-member边界。
- normal end/staged discard 的 archive move、hidden previous recovery目录、historic archive read。
- exact archive deletion、重复 false、ownership/auth/path traversal/failure 保留等 route semantics。

### 属于群策设计建议

- 增加 durable team WAL、明确事件 schema/version、aggregate eventSeq、causation/idempotency key。
- 将 snapshot 与 WAL cursor/checksum/schema version绑定。
- 以 queue/delivery/read/consume/complete 五阶段替换单一 receipt 语义，并增加消费幂等 ledger。
- 用跨进程 lock或单 writer service保护多进程 mutation，建立缺口/冲突恢复。
- 归档前持久化 stopping/drain-complete，递归 drain direct/descendant、冻结新 admission。
- 永久删除前写 tombstone/audit，明确是否清理 Session log、retired index、hidden previous、client cache 和外部 artifacts。
- 将 runtime checkpoint、task replay、event replay、state snapshot 命名分开，避免把 projection fold称为全量恢复。

### 仍需真实运行时或宿主资料验证

- Host Session `append` 与 team.json 写入的跨文件原子性和事件缺口补偿。
- DSH 多进程/多窗口同时改同一团队时的实际丢写与损坏行为。
- `acknowledgeMailbox` 在真实 host queue/admission/model step 中是否等价于 read/consume；`readAt` 的语义是否已迁移完成。
- 成员 stopping、后代 activation、旧 input、settlement wakeup 在真实 Loader/宿主中的递归 drain。
- cold recovery 跨进程、跨重启的 exact-generation 行为与外部工具副作用。
- archive rename、hidden previous 清理失败后的实际恢复/重试路径。
- 永久删除后 Session travelling copy、retired-members index、客户端缓存、外部日志和 workspace artifacts 是否仍可见。
- OpenHands/AG2/CrewAI 的实际 crash window、fsync/durability、跨进程 lease 和外部 side-effect ledger；官方资料只证明各自文档/源码所写的局部语义。

## 十一、实际检查命令与结果记录

以下只读检查在 Windows 工作区执行。插件工作树执行前为 `refactor/0.2.1-only`，未产生工作区修改；主仓库检查显示本任务新增目标笔记目录，既有 `docs/agents/workspace.yaml` 修改及规则/缓存未跟随本任务处理。

```powershell
pnpm typecheck
node scripts/projection-tdd.mjs
node scripts/plugin-records-tdd.mjs
node --test scripts/archive-delete.test.mjs
node --test scripts/corrupt-teamjson.test.mjs scripts/member-spawn-recovery.test.mjs scripts/no-progress-recovery.test.mjs
git status --short --branch
```

实际结果：

| 命令 | 退出码 | 结果 |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit` 完成，无错误输出。 |
| `node scripts/projection-tdd.mjs` | 0 | 10 tests，10 pass，0 fail，0 skipped；`duration_ms 22.6556`。 |
| `node scripts/plugin-records-tdd.mjs` | 0 | 5 tests，5 pass，0 fail，0 skipped；`duration_ms 76.172`。 |
| `node --test scripts/archive-delete.test.mjs` | 0 | 13 tests，13 pass，0 fail，0 skipped；`duration_ms 497.8262`。 |
| `node --test scripts/corrupt-teamjson.test.mjs scripts/member-spawn-recovery.test.mjs scripts/no-progress-recovery.test.mjs` | 0 | 24 tests，23 pass，0 fail，1 skipped；跳过项是 Windows 不执行 POSIX `chmod` 的 EACCES 场景；`duration_ms 646.4264`。 |

这些是目标插件的定向类型、projection、plugin-record、archive-delete、损坏状态与恢复测试，并非 `pnpm verify` 全套结果；本轮没有执行 `pnpm verify`、`pnpm build` 或真实 Loader/GUI 端到端测试，因此不把“全套 verify 通过”写成结论。

已完成的只读源码核对覆盖：`src/event-types.ts`、`src/events.ts`、`src/plugin-records.ts`、`src/projection.ts`、`src/state.ts`、`src/mailbox.ts`、`src/snapshot.ts`、`src/scheduler.ts`、`src/tools.ts`、`src/client/activity-monitor.ts`、`src/types.ts`；测试覆盖 `scripts/projection-tdd.mjs`、`scripts/plugin-records-tdd.mjs`、`scripts/archive-delete.test.mjs`、`scripts/corrupt-teamjson.test.mjs`、`scripts/member-spawn-recovery.test.mjs`、`scripts/no-progress-recovery.test.mjs`，并核对了 `package.json:90-112` 的验证命令。外部材料通过官方 URL/fixed commit 定位，未把搜索摘要或二手文章当事实。

主仓库 `git status --short --branch` 的实际结果为：`master...origin/master [ahead 1]`，已有 `M docs/agents/workspace.yaml`、未跟踪 `.dsh-mattskillsdeck-cache/`、规则文件与本次 `docs/research/`；插件工作树结果为 `## refactor/0.2.1-only`。本任务未修改插件工作树、HTML、规则文件、Issue 或 git 历史。