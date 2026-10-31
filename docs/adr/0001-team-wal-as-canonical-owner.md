# Team WAL 作为唯一事实源

**Status**: recorded-from-plan

**记录目的**：为天枢·群策首个代码仓库闭环建立领域与架构基线。本记录描述已由用户确认的设计方向，不把尚未实现的 Host、Client 或安装行为写成已验证事实。

## Context

团队状态必须可重放、可恢复、可人工接管；外部 DSH Session 的消息接纳回执不能冒充任务完成。现有参考插件以 `team.json` 与 `inbox/*.jsonl` 保存状态，写入锁只覆盖单个进程；DSH `storageDomain` 的写链也只覆盖一个已打开域，`storage-json` 只提供当前净状态的原子发布，并明确采用“一进程一写者”语义。Host Session 持久层拥有跨进程锁，但锁属于 Session 私有实现，插件不把它当作团队文件锁 API。

## Decision

1. **Team WAL 是唯一 durable owner。** 每个团队的可变事实都进入不可变、可重放的事件历史。事件至少携带 `schemaVersion`、`eventId`、单调的 `eventSeq`、`causationId`、`idempotencyKey`、`aggregateVersion`，并在任务执行事件中携带 `attemptId`。任务状态、依赖图、成员状态、邮箱正文、投递/读取/消费/完成回执和生命周期状态都由 WAL 折叠得到。
2. **快照与读面是派生物。** 快照绑定 `lastEventSeq`、WAL digest 与 schema version，可由 WAL 删除后重建。DSH `storageDomain/storage-json` 可承载类型校验后的快照、索引或读面；它不承载 Team WAL，不拥有邮箱或归档事实，也不作为第二真相源。Session record、客户端活动投影和跨会话摘要均是 Travelling Copy，只承担审计、携带和展示。
3. **邮箱不设独立 owner。** 邮箱正文与各阶段回执都是 Team Event。`queue`/`steer` 的 Host 接纳结果单独记录为外部交互证据；Host 返回 `accepted` 只表示消息进入 Agent inbox，不表示模型响应、工具执行或任务完成。
4. **归档迁移完整团队历史。** 归档先记录 `archiving`，等待活动 attempt 与消息处理完成，再记录 `drain-complete`、`archived`，随后迁移完整团队目录。归档目录继续保存原 WAL；不建立 archive manifest、归档 WAL 或其他平行 owner。恢复沿用原团队身份和历史，再记录恢复事件。
5. **删除采用目录缺席语义。** 删除先在 WAL 中记录请求和完成意图，完成后清除整个团队目录及其派生物：WAL、快照、邮箱、归档内容和群策创建的成员会话一并移除，不保留 tombstone、删除收据或团队摘要。用户原有普通会话保留；删除完成后，团队数据根下没有该团队目录即表示团队不存在。宿主 Session 自己的历史仍由宿主规则管理，不由群策伪造清理结果。
6. **V1 采用单 Host 写入边界。** 同一个群策数据根只允许一个 DSH Host 取得团队写入权；一个 Host 内可以并行运行多个团队、成员和任务。第二个 Host 不进入团队写平面，而是报告 writer 已占用并进入不可写的 `needs_attention` 状态。实现必须提供稳定的根级 writer lease，并在 POSIX 与 Windows 上分别验证；当前 DSH `storage-json` 的原子替换和进程内 write chain、Session 私有锁均不能被当作这个 lease 的替代品。跨 Host 同写不属于 V1 合同。

## Alternatives considered

- **DSH `storageDomain/storage-json` 直接承载团队净状态**：保留了官方 schema、版本和生命周期能力，但它不是 append-only WAL，且“一进程一写者”不足以覆盖跨 Host 语义；因此降为快照与读面承载。
- **SQLite WAL 作为团队 owner**：事务、唯一约束和消费 ledger 很强，但目标 DSH 的 `node:sqlite` 带 experimental warning，插件当前没有已验证的 SQLite 分发依赖；先不把数据库引入 V1 的安装面。
- **JSONL WAL 加 SQLite 索引或独立 mailbox/archive/tombstone 文件**：会制造第二个事实 owner，且删除与恢复边界变得含糊；保留单一 Team WAL，所有读面从它重建。
- **复用 DSH Session 私有写锁**：锁定的是 Session artifact，且公开能力边界没有把它承诺给外部插件；不把内部实现当作插件契约。

## Consequences

正向结果是：事件重放、快照重建、邮箱阶段分离、attempt generation、归档恢复和人工接管都有一条明确事实链。代价是：V1 必须实现并验证根级 writer lease、WAL 缺口/重复/父链检查、快照游标校验、恢复扫描和删除前后的生命周期顺序；跨 Host 同写、WAL 与外部副作用的 exactly-once 语义、正式 policy registration、动态 principal 允许/拒绝仍是后续验收面。

## Compatibility boundary

实现锁定 DSH `0.2.1-rc.2`、Node `22.23.2` 的已读 Host 契约：`sessionController.prompt` 的 `queue|steer` 只提供消息接纳回执，`sessionController.selectModel` 的选择从下一个请求生效；插件不改 Agent loop，不通过 DOM/iframe，不把 `sessionReferenceResolver` 当作消息投递。安装物必须继续遵守 DSH 插件的 Host/Client bundle、peer pin 和 lifecycle 约束。

## Baseline sync

`GLOSSARY.md` 记录本决策所依赖的领域词汇；本 ADR 记录当前 ownership、兼容边界和未验证项。实现票 #2 的 Host 状态层与动作契约必须把本 ADR 转换为类型、事件 envelope、writer lease、恢复验收和删除验收；在 #2 通过前，本记录的实现部分保持 `recorded-from-plan`，不视作运行时证明。

## Evidence references

- `docs/research/2026-10-31-tianshu-qunce-persistence.md:22-210`：当前参考插件的持久化事实、WAL 建议、邮箱回执、归档/删除矩阵与 OpenHands 增补。
- `docs/research/2026-10-31-tianshu-qunce-contracts-session.md:486-519`：DSH Session 模型路由、queue/steer、principal、幂等与未覆盖边界。
- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-storage-domain\lib\index.js:93-101,193-225,337-397`：Domain 进程内写链、先持久化再更新内存、schema 校验与生命周期。
- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-storage-json\lib\index.js:8-17,57-64,161-167,275-299,540-607`：原子替换、净状态格式、一进程一写者、per-record 语义与 backend lifecycle。
- `D:\deepseek HARNESS\resources\app\dsh\node_modules\@deepseek-ai\dsh-session-persistence-jsonl\lib\index.js:619-648,655-722`：Session 私有跨进程锁的边界。
- `D:\dsh-workspaces\dev\local-plugins\dsh-agent-teams-router\src\state.ts:993-1088`、`src\tools.ts:2672-2677`：参考插件归档/删除行为，作为比较材料而非群策现状。
