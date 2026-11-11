# 玄驹

DeepSeek Harness 的多智能体团队插件。一句话把当前会话变成队长：拆任务、派队员、按依赖自动调度，Web 界面里看得见谁在干什么。

包名 `@zhuifengqug/dsh-ant`，宿主侧插件 id 仍是 `agent-teams`。

## 与上游的关系

本仓库是 [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) 的分支（fork），基线 `0.1.29`。上游的功能照单全收，本分支只叠加四件事，全部有测试兜底：

- **中文语言约束**：团队提示词与全部工具参数描述要求队名、成员名、任务标题与描述、计划摘要一律用当前对话语言书写，工具名、id、路径、代码标识符保留原文。
- **归档团队永久删除**：归档列表里可以真正删掉一个团队（先精确匹配 id，再绑定归属会话，两击确认），不再只能堆积。
- **无进展标记**：快照按滑动窗口算出 `noProgress` / `noProgressForMs`，卡住的任务可被观测；只读，不改派发。
- **验证只重跑失败命令 + 证据绑定**：质量门禁的复核只重跑失败或缺的命令，验收证据打上 attempt 戳，跨代证据在闸门前就被拒。

路由决策、难度评分卡、成本汇总、routeAudit 这几块上游本来就没有，本分支也不引入。

## 安装

本地开发目录安装（`link:` 指向本仓库）：

```powershell
dsh plugin --profile desktop add D:\dsh-workspaces\dev\虫珀\玄驹
```

装完在 profile 的 `dsh.profile.bundles` 里出现 `@zhuifengqug/dsh-ant`，重启 DSH Desktop 生效。

## 用起来

自然语言即可。说「用 AgentTeams 做 X」，队长会：

1. 调用 `agent_teams_create` 提交团队计划（默认待审批）。
2. 你在 Web 计划面板里确认成员、模型与任务图，明确批准后开跑。
3. 队长派活、队员认领、依赖满足即调度；你随时可以问 `agent_teams_status`。

宿主侧共 14 个协调工具（`create` / `approve` / `edit_plan` / `add_member` / `remove_member` / `create_task` / `reassign_task` / `claim_task` / `update_task` / `amend_task` / `send_message` / `status` / `resume` / `delete`），队员子集是其中 4 个。

## 界面

- 会话标题栏的团队入口，点开是活动面板：成员、模型、任务依赖、收件箱。
- 右栏标签与工作区完成卡、收件箱卡。
- 团队状态存在 `<工作区>/<stateDir>/<团队 id>/` 下（`team.json` + `inbox/*.jsonl`）。

## 文档

- [使用说明](./docs/usage.md)
- [质量门禁](./docs/quality-gates.md)
- [验证指南](./docs/verification-guide.md)
- [渐进披露](./docs/progressive-loading.md)
- [维护流程](./docs/maintenance-workflow.md)
- [插件开发](./docs/developing-dsh-plugins.md)
- [README 写作规范](./docs/readme-writing-guide.md)
- [贡献指南](./CONTRIBUTING.md)

## 验证

```powershell
npx pnpm run typecheck
npx pnpm run build
npx pnpm run verify
```

`verify` 串起契约、质量门禁、兼容性、客户端与 fork 自有四处改动的全部用例，末段会校验 `lib/` 与源码一致（`git-artifacts`）。

## 兼容性

宿主最低版本由 [`compatibility.json`](./compatibility.json) 里最旧的兼容项派生：推荐 `0.2.1-rc.2`，已在 `0.2.2-rc.1`（preview）上验证。当前开发的宿主是 `0.2.2-rc.1`。

## 许可

MIT，见 [LICENSE](./LICENSE)。上游版权归 NanmiCoder，本分支改动同样以 MIT 发布。
