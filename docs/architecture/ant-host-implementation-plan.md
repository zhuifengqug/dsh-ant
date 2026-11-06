# 虫珀·玄驹 #9 Host 实施计划

## Goal / Architecture / Tech Stack

依已复审的 [Host 契约](ant-host-contract.md) 实现真实 Host：严格 DTO → 唯一动作 owner → fenced 根租约 → 每团队串行事务 WAL → 可重建读面 → Session/Typert/命令/工具适配器。目标 DSH 0.2.1-rc.2、Node 22.23.2；先用原生 ESM 和 Node 内建测试，接入层使用目标版本已发布 API。

本计划沿用架构文档目录，和父契约相邻。Aegis 用于约束新持久化 owner 的文件边界与验证，而不是追加设计批准门。

## Baseline / Authority / Compatibility

- [领域术语](../../GLOSSARY.md)、[ADR-0001](../adr/0001-team-wal-as-canonical-owner.md)、[架构基线](ant-baseline.md)、[Host 契约](ant-host-contract.md)、[Client 输入](ant-client-design.md)。#2/#3 已复审；#9 的代码实施属于总目标。
- Team WAL 是唯一团队事实源；租约元数据仅表示当前写入资格，不持有团队状态。快照、读面、Session 副本不能替代 WAL。
- 不改 DSH Agent loop、既有 agentTeams/subagents 或用户 profile；不复用 Session 私有锁。静态 Client 仅用 Typert Remote。
- 基线第 24 行旧“非法父链”以新 Host 契约的 causation 引用校验为准，代码落地时同步基线。

## Requirement Ready / Change Necessity / Complexity

已批准契约给出 19 动作、payload、幂等、fencing、序列、权限、归档删除和四入口要求。仓库目前没有 package/src/可复用实现；文档或配置不能执行这些能力，决定为 code-change。

新增最小 owner：`src/core/{errors,canonical,codec,writer-lease,wal}.mjs`；随后 `src/core/{fold,actions}.mjs`，Host 适配单独放 `src/host/`。单文件单职责；核心文件目标约 250 行内，超过时拆任务而不混入 Host 业务。复用 Node 文件/crypto/net API，核心不引入第三方依赖；无旧代码需要退休。

公共 contract 和持久化 ripple 影响未来 Typert、Client、命令、工具。所有入口共用 codec/动作 owner，测试按 WAL/幂等/权限/回执而非单纯语法证明正确性。

## TDD Route / Execution

Mode: off / Decision: skipped / Strict authority: none。采用实现后的行为回归与故障注入；不宣称 RED/GREEN。执行 inline；当前任务模块强依赖，协调成本高于并行收益。现分支 master 继续；不创建 worktree。

TaskStartSnapshot：root `D:\dsh-workspaces\dev\虫珀\玄驹`；HEAD `e52b236ffb9e62ab3d605b3c2fbf16904cece79a`；master ahead 7；暂存为空；既有修改 `docs/agents/workspace.yaml`，未跟踪 `.dsh-mattskillsdeck-cache/`、`AGENTS.md`、`docs/agents/{domain,issue-tracker,triage-labels}.md` 全保留。一个工作树，无 merge/rebase/cherry-pick 状态。

## 任务与证明

1. 核心持久化：新增 errors/canonical/codec/writer-lease/wal 和 `tests/core/`。严格嵌套 schema、RFC 8785 兼容 JSON canonicalization、根独占、epoch/token、每团队串行、原子事务文件、checksum/replay、快照验证。运行 `node --test tests/core/*.test.mjs`；测试真实子进程冲突与退出恢复、相同请求重放、不同 payload 冲突、并发序列、损坏阻断和快照重建。
2. 动作与共享视图：新增 fold/actions/shared DTO。实现全部 19 动作、scope/principal、CAS、依赖 DAG、attempt generation、邮箱阶段和归档/删除。正/负路径与跨入口相同 receipt 测试；补齐 Client 所需 TeamView schema。
3. Session 接口：以实时 inspection 核实 prompt/selectModel/create/cancel 与会话归属；adapter 区分 admission 与完成，不伪造质量通过/读取回执。故障/恢复/原会话保留测试。
4. 插件发布面：package、命名 manifest、patch、locale/icon、Host Service、Typert 生成物、命令/工具。离线名称验证、独立 registry 查询、build/typecheck/test/pack 检验；真实 Loader composition 检查卸载清理。客户端实现属于 #4，安装属于 #8，不用 mock 代替。
5. 核验收口：独立复核持久化与权限；限定路径提交。记录真实执行命令/平台和未覆盖项，更新 #9 与地图。WAL/lease 未通过运行检查时不关 #9；完整 Goal 保持 active，直到安装与 #11 E2E。

## 首个增量的物理协议

本机 V1 根租约用 IPv4 loopback TCP 独占监听：端口只由 canonical root hash 推导，不接受调用者覆盖；端口占用显式 lease-conflict，包括不同 root 的端口碰撞。监听不处理业务消息。epoch 文件原子替换，token 随 owner 生成；每次 WAL 写入在持有 socket 的 guarded operation 内验证 epoch/token，release 等待进行中的操作。进程退出由 OS 释放 socket；不靠 stale-timeout 抢锁、不引用 DSH 私有 API。共享跨机器/network filesystem 不在此机制的证明范围；Windows UNC root 显式拒绝。Windows 实测与其它 OS 未测分开记录。

WAL 使用 `teams/<teamId>/events/<firstEventSeq>.json` 的不可变事务记录，每个文件包含一组事件与其 receipt/checksum；同目录临时文件 fsync 后 hard-link 到最终文件（禁止覆盖），最后移除临时链接。POSIX 再 fsync 父目录，Windows 的断电目录 durability 留作平台验证缺口。未提交临时文件不进入重放；已提交但调用方未收到响应可由 receipt 重放。任何 sequence/checksum/schema/causation 矛盾显式 rebuild-required。

## Checkpoint / Drift

当前：任务 1 实施中，其余待执行。验收事实只写已运行的检查。若新增第二团队 owner、改公开 ABI、放宽 user-only authority、租约不能排他或使用 fallback 吞错误，先停在对应 owner 修正，再继续。下一步：核心源码与测试；最终交付面仍是实际安装插件，不是本计划或局部测试。
