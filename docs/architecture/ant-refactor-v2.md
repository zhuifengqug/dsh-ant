# 玄驹 v2 重构方案：吸收矩阵与实施顺序

状态：讨论定稿 v2.1（2026-11-07，按用户答复修订）。本文是 `/to-spec` 的输入，不含代码改动。
基线：`@zhuifengqug/dsh-ant@0.1.0`，HEAD `413f909`，`node --test tests/core/*.test.mjs tests/host/*.test.mjs tests/client/*.test.mjs` = 32 pass / 0 fail。

## 0. 本轮由用户裁决的四项（2026-11-07）

| 问题 | 用户裁决 | 对方案的影响 |
|---|---|---|
| 真实使用场景 | **A：一个人、一个仓库、几小时的长任务** | WAL/归档/恢复/接管全部保留；跨人权限与多人协作不做 |
| 团队规模 | **4–8 人** | 调度器与看板是必需品；并发上限按 8 设计；看板要分组而不是平铺 |
| 放手程度 | **L2 批量放行** | 质量门通过后不立即派下游，攒成批次由用户一次放行 |
| 能力取舍 | **要成本归因 + 多候选采样**；工具策略、低峰派发、可视化画布**留待下次更新** | 成本从 P1 升到 P0；采样从 P2 升到 P0 并需扩动作面；三项推迟，只在文档留接口位 |

## 1. 定位

- **玄驹 = 蚁群**：围绕单个代码仓库目标组织的常驻团队，成员分工、并行冲刺、可暂停可恢复可接管。
- **虫珀 = 琥珀 = 封存的历史**：WAL、快照、归档、恢复归此名下；虫珀不是团队本体，是团队事实被原样封住的那一层。
- **一体式**：团队是壳，并行 fan-out 是它的一种执行模式（冲刺），不是独立产品形态。
- **成员以子代理为主**，普通 DSH 会话作为可选「外部工位」。
- **双面驱动**：命令与工具让模型自驱推进；面板承担观察、人工动作与批次放行，不做组织架构配置。
- **与 DSH 原生 Agent Teams 完全解耦**（用户 2026-11-07 裁决）：不注入 `agentTeams`、不做 teamId ↔ leadSessionId 绑定、不双语写任务板。玄驹只依赖 `sessionController`（`index.js:8` 现有 inject 不变）。

## 2. 三条不可再分需求

| 需求 | 含义 | 现有支撑 | 缺口 |
|---|---|---|---|
| 并行吞吐 | 一个目标同时被多成员推进 | 任务依赖 + attempt 代次 | 无批量任务图、无环检测、无调度器 |
| 跨轮可信 | 中断/崩溃/换模型后能续，状态不撒谎 | WAL + 根级 lease + fencing + 五段回执 | 归档/恢复/删除只停在事件层 |
| 责任归属 | 谁做的、花了多少、过没过门 | `quality.report` + `member.changeModel` | 无成本归因、无他证审查、无活动审计流 |

部门/工号/M-P 通道/编制/晋升属**组织模拟**，不解决上述任一条，v2 明确不做。

## 3. 吸收矩阵 v2.1

优先级：P0 = v2 必须；P1 = v2 内可延后一个迭代；**下次更新** = 本轮明确推迟，只保留接口位与文档说明。

| # | 机制 | 来源 | 落点 | 优先级 |
|---|---|---|---|---|
| 1 | 批量任务图：一次提交带 `key` 依赖的任务集，6 类校验（空/超限/字段非法/重复 key/坏引用/环） | member-manager `company_plan` | 新动作载荷 `plan.propose`（扩展）+ `src/core/plan.mjs` 增环检测 | P0 |
| 2 | 唤醒式调度：空闲成员原子领取一项就绪任务 | agent-teams 调度器 | 新模块 `src/core/advance.mjs` | P0 |
| 3 | 停驻 attempt：驻留成员被中断只停当前代次，消息可续，不换 attemptId | agent-teams | `attempt.pause/resume` 补「停驻不失效」判定 | P0 |
| 4 | 项目级幂等指纹：`goal` + 任务清单哈希，重复提交不重跑整轮，`rerun` 显式放行 | swarm-orchestrator | `src/core/canonical.mjs` 增 `projectFingerprint`，`plan.confirm` 前置校验 | P0 |
| 5 | 质量门结构化：1 名 reviewer + 1 名 repair owner + 显式判据 + 0..2 轮修复，禁止递归与临时建员 | agent-team-gui | 新模块 `src/core/gate.mjs`，`quality.report` 拆自证/他证 | P0 |
| 6 | 谁建造谁不验收：持有过该任务 claim 的成员不得作为 reviewer | Contexera/dsh-agent-team | `gate.mjs` 校验 + WAL 记录 claim 历史 | P0 |
| 7 | 运行记录先落盘：规划前先写 run 头，重启把未完成 durable 状态标 `interrupted` | agent-team-gui Run Center | `run.interrupted` 事件 + 恢复折叠 | P0 |
| 8 | **L2 批量放行**：门通过的任务进入放行批，用户一次放行才派发下游；批次有窗口与提醒，超时不动 | dsh-lowtide L2 档 | 新模块 `src/core/batch.mjs` + `batch.release` 动作 | P0 |
| 9 | **多候选采样**：同一任务派 N 个隔离候选（各自 attempt + 会话），并列呈现，用户选定后其余作废 | dsh-lowtide Sampling、Visual-Workflow 多路 | `attempt` 加 `variant` 维度 + `attempt.select` 动作 | P0 |
| 10 | 成本与审计：token/请求按成员/任务/attempt/候选归因，只读报告 | member-manager `/company/costs` + `audit.jsonl`、dsh-whale-report | 新增 `spend.recorded` 事件 + `src/core/spend.mjs` | P0 |
| 11 | 逐成员活动流：每成员一行（状态/模型/此刻工具与目标文件/步数/耗时） | swarm `input.dock`、member-manager 工作网 | `src/host/activity.mjs` + `client.js` 新面板 | P0 |
| 12 | 会话血缘清理：删除团队时按 Lead 会话递归 dispose 其派生会话 | dsh-sessions-manager、better-dsh-session-deletetool | `lifecycle.mjs` 消费 `decide.mjs:134` 的 `memberSessions` | P0 |
| 13 | 递归深度限制：成员默认不得再开子代理 | swarm `maxDepth:1`、agent-teams `memberMaxDepth:0` | `sessionController.create` 前置校验 | P1 |
| 14 | 成员工具策略 allow/deny（deny 使工具从 schema 消失） | agent-teams `toolPolicies` | **下次更新**，文档留 policy id 字段位 | 下次更新 |
| 15 | 低峰时段派发（`notBefore` 预约执行） | dsh-lowtide | **下次更新**，`attempt.dispatch` 留 `notBefore` 字段 | 下次更新 |
| 16 | 可视化编排画布 | Visual-Workflow | **下次更新**（只保留节点/连线概念对齐） | 下次更新 |
| 17 | 组织模拟（部门/工号/晋升/借调） | member-manager | **不做** | — |
| 18 | HTTP API 面 | member-manager | **不做**（保留 Typert Remote 四入口） | — |
| 19 | 多 Host 并发写 | — | **不做**（保持单 Host 写入 + 根级 lease） | — |

## 4. 动作面变更

现有 19 个请求动作（`src/core/codec.mjs` / `src/core/decide.mjs`）：`team.create`、`plan.confirm`、`attempt.{dispatch,retry,pause,resume,takeover,terminate}`、`quality.report`、`member.{invite,accept,remove,changeModel}`、`mail.{send,read,consume}`、`team.{archive,restore,delete}`。

v2 增量（全部新增，不改既有语义）：

| 动作 | 理由 | 约束 |
|---|---|---|
| `task.claim` | 成员原子领取就绪任务的显式事实 | CAS `aggregateVersion`；仅已确认团队 |
| `task.complete` | 与质量门分离：完成 ≠ 过门 | 幂等键绑定 attemptId |
| `quality.review` | 他证：reviewer 判定 pass/fail + 判据命中 | reviewer ≠ 任何 claim 持有者 |
| `batch.release` | L2：用户一次放行整批待派任务 | 需列出被试放行的 taskId 集合；缺失项原样保留 |
| `attempt.select` | 多候选采样：用户选定某一 `variant`，其余作废 | 需 `attemptId` + `variant`；作废走 `attempt.terminate` |
| `run.interrupted` | 宿主重启后把未完成 run 标中断 | 仅恢复期由 system 写 |

新增事件（折叠进 `src/core/fold.mjs`）：`task.claimed`、`task.completed`、`quality.reviewed`、`batch.released`、`attempt.selected`、`run.interrupted`、`team.drain-complete`、`team.archived`、`spend.recorded`。
其中 `team.drain-complete` 与 `team.archived` 目前只有折叠分支没有生产者（`src/core/fold.mjs:74-75`），v2 由 `lifecycle.mjs` 补齐。

## 5. L2 批量放行（batch.mjs）

默认自主级 L2，团队级可覆盖为 L1（逐任务）或 L3（全自动，需显式开启两次确认）。

- 门通过的任务进入**待放行批**，状态 `ready`，不自动派发。
- 批次窗口：默认 30 分钟内的就绪项归入同一批；面板出闸门卡列出本批任务、负责成员、预计 token。
- 用户 `batch.release` 放行 → `advance.mjs` 按依赖与并发上限派发；未放行则原样等待，超时不作废也不自动放行。
- 放行是唯一入口：模型无法自行调用 `batch.release`（权限等同用户动作，见 `src/core/decide.mjs` 的 user-only 集合）。
- L3 档把闸门关掉，就绪即派；L1 档每批只含 1 项。

## 6. 多候选采样（variant）

- 派发时可选 `variants: N`（默认 1，上限 3）。每个候选是独立 attempt（同任务、同代次基、不同 `variant`），各自独立会话与独立成本记录。
- 候选用同一份任务说明与同一份输入上下文；不得共享工作目录的写权限（否则互相覆盖）——**v2 只允许只读类候选并行，写类任务禁止 N>1**，该限制在 `attempt.dispatch` 前置校验。
- 并列呈现：面板并排展示 N 份产出与各自成本。
- `attempt.select` 选定后，其余候选 `attempt.terminate`，被取消的成本仍记入账。
- 采样的成本是 1×N，成本看板按 `variant` 分行。

## 7. 调度器（advance.mjs）

不变式：**调度器不是第二个真相源**。它只做三件事——读 WAL 视图、挑一个已放行的就绪任务、写一条 `task.claimed`/`attempt.dispatch` 事务。

- ready 判定：任务无 owner、依赖全部 `completed` 且已过门、团队 lifecycle ∈ {planned, running}、无未结 attempt、**已被 `batch.release` 放行**。
- 原子性：claim 走 `TeamWal.transact` + `aggregateVersion` CAS；竞争失败者重读视图。
- 并发：在上限 8 内按成员数派发；采样候选计入并发。
- 停驻：成员 `inactive` 但持有开放 attempt 时**不重新派发**，只发 `mail.send`（steer）唤醒，沿用原 attemptId。
- 重启恢复：`run.interrupted` 后遗留开放 attempt 进 `needs_attention`，不自动重试。
- 幂等：同 `requestId` 与同 `projectFingerprint` 不得产生第二轮全文派发。

## 8. 质量门（gate.mjs）

两段事实不能混：`quality.report` = 执行者**自证**；`quality.review` = 审查者**他证**。任务只有两者均 pass 才算 `completed`，才进入待放行批。

- reviewer 选取：团队内非该任务 claim 持有者；无可用 reviewer 时门不通过并返回 `needs_attention`，不静默放行。
- 修复轮次上限 2；超限 → 任务 `failed`，attempt 永久保留。
- 禁止 reviewer 递归开子团队或临时建员。

## 9. 可观察层与成本

界面形态见 `docs/architecture/ant-colony-ui.md`：主面板为**蚁巢剖面**（五室 = 五态、蚁道 = 依赖、蚂蚁 = 成员），侧栏显示待放行计数，活动流默认折叠为三组计数。

- 成员四态：`running / inactive / provisioning / failed`（补上现在缺的后两态）；4–8 人规模按「进行中 / 空闲 / 需干预」三组折叠，需要时展开。
- 逐成员活动流：模型、当前工具、目标文件、步数、耗时；只展示事实，不推断完成。
- 五泳道：待派 / 待放行 / 执行中 / 已完成 / 异常；「待放行」是 L2 特有的第五态。
- 成本：按成员 / 任务 / attempt / variant 四维聚合，只读；采样的 N 倍成本单独成行。
- 运行记录页：规划前先落盘；重启后未完成项显示 `interrupted`。

## 10. 新模块与修改点

| 文件 | 类型 | 职责 |
|---|---|---|
| `src/core/lifecycle.mjs` | 新增 | archiving → drain → `team.drain-complete` → `team.archived` → 迁移 `teams/<id>` 到 `archive/<id>`；恢复迁回；删除先递归 dispose 成员会话再移除目录，失败保留目录 + `team/persistence-failed` |
| `src/core/advance.mjs` | 新增 | 调度器：只派已放行的就绪任务 |
| `src/core/batch.mjs` | 新增 | L2 放行批：窗口、闸门卡数据、放行校验 |
| `src/core/gate.mjs` | 新增 | 判据、reviewer 选取、0..2 轮修复、禁止递归 |
| `src/core/spend.mjs` | 新增 | 成本折叠（含 variant 维度） |
| `src/host/activity.mjs` | 新增 | 活动流聚合 |
| `src/core/canonical.mjs` | 修改 | 增 `projectFingerprint(goal, tasks)` |
| `src/core/plan.mjs` | 修改 | 环检测与 6 类校验明细 |
| `src/core/fold.mjs` | 修改 | 折叠 9 类新事件 |
| `src/core/decide.mjs` | 修改 | 6 个新动作分派与权限；`decide.mjs:49` 的 archiving 只允许 delete 不变 |
| `src/core/codec.mjs` | 修改 | 新动作 strict 校验；`variants` 与 `notBefore` 字段位 |
| `client.js` | 修改 | 活动流 + 五泳道 + 闸门卡 + 候选并排 + 成本页 |
| `tests/core/{lifecycle,advance,batch,gate,spend}.test.mjs` | 新增 | 覆盖迁移/删除/调度/放行/门/成本 |
| `tests/host/consistency.test.mjs` | 新增 | 同一 `requestId` 跨 command / tool / Remote 三入口 receipt 逐字段比对 |

## 11. 迁移顺序

**阶段 1 · 生命周期（#12）**
验收：归档后 `teams/<id>` 消失、`archive/<id>` 出现且 WAL 完整；恢复后迁回、`eventSeq` 延续；删除后目录缺席、成员会话已 dispose、重放返回 `team/not-found`。

**阶段 2 · 调度 + L2 放行 + 质量门（#2/#3/#5/#6/#7/#8）**
验收：提交 3 任务 DAG，门通过后任务停在「待放行」；`batch.release` 后无依赖两项并行领取；下游在上游双门通过且放行后自动派发；中断成员后唤醒沿用原 attemptId；reviewer 不得是 claim 持有者；重启后未完成项标 `interrupted`。

**阶段 3 · 多候选采样（#9）**
验收：只读任务 `variants:2` 产生两份独立产出与两笔成本；写类任务 N>1 被前置校验拒绝；`attempt.select` 后另一候选 terminated 且成本仍入账。

**阶段 4 · 观察面与成本（#10/#11）**
验收：活动流实时；成本按四维可查；UI 改动用同一场景、同一视口、同一主题的 Before/After 截图。

**阶段 5 · 幂等与递归限制（#4/#13）**
验收：同 `projectFingerprint` 重复提交不产生第二轮派发，`rerun` 可放行；成员尝试再开子代理被拒。

## 12. 明确不做 / 下次更新

- **不做**：组织模拟（部门、工号、M-P 通道、编制、借调、晋升）；HTTP API 面；多 Host 并发写；与原生 `agentTeams` 的任何绑定。
- **下次更新**：成员工具策略 allow/deny（#14）、低峰时段派发（#15）、可视化编排画布（#16）。三者只保留字段位与章节说明，本轮不实现。

## 13. 风险登记

1. **两套团队并存**：若同时开启原生 Agent Teams，模型会看到两套互不相通的工具面。处置：自有工具统一 `ant_` 前缀，面板显式提示。
2. **L2 放行成为瓶颈**：没人放行＝团队停摆。处置：闸门卡在会话内可见 + 超时提醒，但不自动放行。
3. **采样成本失控**：1×N 且被取消的候选照样计费。处置：默认 N=1、上限 3、写类任务禁止 N>1、成本看板分行。
4. **成本事件侵入 WAL**：`spend.recorded` 会显著增事件量。处置：按 attempt 收口批量落一条，不逐 token 落。
5. **归档迁移与 lease**：迁移必须持根级 lease，否则与第二 Host 冲突。处置：`lifecycle.mjs` 全部操作在 lease 内执行。
6. **活动流误报**：成员「已交付但没更新任务」无法从会话侧判定。处置：只展示事实，不推断完成。
