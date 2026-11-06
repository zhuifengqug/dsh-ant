# 虫珀·玄驹架构基线

状态：设计已确认，实施未验证。决策理由见 [ADR-0001](../adr/0001-team-wal-as-canonical-owner.md)；领域词汇见根目录 [GLOSSARY.md](../../GLOSSARY.md)。

## Owner 与数据流

- **权威写入源**：每个团队一条 append-only Team WAL；团队内的任务、依赖、成员、attempt、邮箱正文、消息阶段回执和生命周期事实全部由 WAL 表达。
- **派生状态**：Team snapshot 绑定 `lastEventSeq`、WAL digest、schema version；任务 DAG、邮箱读面、归档列表和 UI 状态均可从 WAL 重建。DSH `storageDomain/storage-json` 仅承载经 schema 校验的快照、索引或读模型，不承载 WAL，也不拥有团队事实。
- **跨系统副本**：Host Session log、插件 projection、客户端状态和跨会话摘要均为 Travelling Copy，仅承担审计、携带与展示；它们不成为团队恢复的独立权威源。
- **消息完成边界**：邮箱接纳、投递、读取、消费、完成分别记录。`sessionController.prompt` 返回 `accepted` 只证明 Host inbox 接纳，不证明模型响应、工具执行或任务完成。
- **模型路由边界**：成员身份与 `sessionId` 稳定；普通模型切换按 `sessionController.selectModel` 的 pending-selection 语义从下一请求生效。迁移并继续是单独的人工控制动作。

## 运行与生命周期

- **并发契约**：同一玄驹数据根在 V1 只允许一个 DSH Host 写入；单个 Host 内可并行处理多个团队、成员和任务。第二个 Host 的写入必须失败关闭并显式显示 writer 已占用，不得静默分叉状态。
- **Writer lease**：实现必须在 POSIX 与 Windows 上防止两个 Host 同时获得同一数据根的写权限，并在进程异常退出后允许后继 Host 恢复。具体 API 与失效检测机制由 #2 实现阶段针对目标 Node/DSH 环境选定和验证；DSH `storage-json` 的 rename 原子性、Domain 进程内写链、Session 私有锁均不满足替代证明。
- **归档**：先记录 `archiving`，drain 活动 attempt/邮箱处理，再记录 `drain-complete` 与 `archived`，最后迁移完整团队目录。归档保留同一 WAL 与团队身份；恢复接续原历史。
- **删除**：按用户确认的“目录缺席即删除”语义，清除整个团队目录中的 WAL、快照、邮箱和归档内容，并清理玄驹创建的成员会话；原有普通 DSH 会话保留。成功删除后不留 tombstone、删除收据或团队摘要。
- **Host 兼容**：目标基线为 DSH `0.2.1-rc.2` / Node `22.23.2`。插件使用公开 Host 服务和 Cordis lifecycle，不修改 Agent loop，不依赖页面 DOM/iframe，不把只读 `sessionReferenceResolver` 当消息通道。

## 必须满足的恢复不变量

1. WAL append 未持久化时，不对外报告该团队状态变化已完成。
2. 重放时拒绝重复 `eventId`、不连续的 `eventSeq`、非法父链、未知 schema version 与错误 aggregate version；损坏位置明确进入人工处理状态，不以快照静默覆盖。
3. 快照只在其游标与 WAL digest 校验通过时启用；校验失败时从 WAL 重建。
4. 每个 attempt generation 独立；旧 generation 的延迟回执不得覆盖新 generation。
5. 邮箱回执与任务完成分离；外部系统副作用的 exactly-once 未被假定。
6. 归档前必须完成团队与后代 drain；删除仅在已确认身份和清理对象集合后执行，且不误删既有普通会话。
7. 第二 Host 未取得根级 writer lease 时，任何 Team WAL、快照、邮箱与生命周期写操作均被拒绝。

## 留待实现验证

- 根级 writer lease 的跨进程独占、崩溃释放、异常退出后恢复与 Windows/Linux/macOS 行为。
- WAL 文件协议、durability、checksum、event append/replay、部分尾记录处理、事件升级和 snapshot rebuild。
- 普通 Session prompt 的正式 policy registration、principal allow/deny、重复 `requestId` 并发竞争及 Host admission ACK 恢复。
- queue/steer admission、投递、消费与任务完成的分阶段故障注入。
- 归档 drain、成员后代停止、删除部分失败与恢复行为。
- Host/Client bundle 安装、真实 slot 显示、Web/Headless 共享类型化动作与端到端代码仓库任务。

## 来源

- [会话与模型契约研究](../research/2026-10-31-ant-contracts-session.md)
- [持久化与恢复研究](../research/2026-10-31-ant-persistence.md)
- DSH Host service contracts and pinned package sources listed in [ADR-0001](../adr/0001-team-wal-as-canonical-owner.md#evidence-references).
