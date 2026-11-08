# 玄驹仓库模板：需求→实现→验证→审查→集成 五道门脚手架

状态：方案稿（2026-11-08），**尚未实施**。本文给出生成器形态、模板文件清单、门与 ant 既有结构的映射，以及让门真正生效的两处引擎缺口。
基线：`@zhuifengqug/dsh-ant@0.2.0`，HEAD `1aa4928`，测试 83 pass / 0 fail。

## 0. 结论先行

1. **模板不是一组文件，是三件东西**：文件骨架 + 计划种子 + 门的执行者。只交文件等于交纸门。
2. **五道门里现在真有三道**：需求 = `task.objective/acceptance`，实现 = `attempt`，审查 = `quality.review`（`src/core/gate.mjs:4` `reviewAssignment` 已保证审查者不是该任务的 claimant）。验证与集成目前只是数据。
3. **两个确证的缺口**：
   - `plan.qualityGates` 只在建团队时被校验（`src/core/plan.mjs:52-54`），全仓无消费者——`gate.mjs`、`scheduler.mjs`、`releaseBatch` 都不读它。
   - `task.complete` 只要求 `payload.evidence.length > 0`（`src/core/decide.mjs:167` `Completion requires evidence`），不与 `task.verify[]` 对照。执行者写一条 `note` 也算完成。
4. 因此交付形态定为：`tools/ant-scaffold.mjs`（CLI，负责写盘）+ `src/core/template.mjs`（纯渲染，可单测）+ 两处引擎补齐。合计约 450 行（含测试），不动事件类型、不加动作。

## 1. 五道门 ↔ 既有结构

| 门 | 谁执行 | ant 里的载体 | 判定条件 | 现状 |
|---|---|---|---|---|
| 1 需求 | 人 + 蚁后 | `goal`、`tasks[].objective/acceptance`、规格票 | acceptance 非空且能追溯到规格票 | 已有（`codec.mjs` task 必填 acceptance/verify） |
| 2 实现 | 工蚁 | `attempt.dispatch` → `attempt.admitted` | attempt 处于 running | 已有（`src/core/scheduler.mjs`） |
| 3 验证 | 执行者 + 机器 | `tasks[].verify[]` + `task.complete.evidence` | verify 每条都有 `kind='command'` 证据，locator 命中 | **缺校验** |
| 4 审查 | 独立成员 | `quality.review` | reviewer 不在该任务 attempts 里，criteria 非空 | 已有（`gate.mjs` reviewAssignment） |
| 5 集成 | 人（L2 批量放行） | `batch.release` → merge + tag | 该任务所有 gate 都有 pass 记录 | **缺消费者** |

要点：门不是新机制，是把已经存在的事件串成一条不许跳的链。模板的职责是让这条链在新仓库里**默认存在**，而不是事后补文档。

## 2. 模板文件清单（写进目标仓库）

```
AGENTS.md                        项目工作规则：先方案后改动、提交规范、测试前置
README.md                        一句话定位 + 安装 + 目录地图
GLOSSARY.md                      术语表（领域词在此收口，避免同物异名）
docs/agents/domain.md            单上下文领域说明
docs/agents/issue-tracker.md     issue 载体与操作方式
docs/agents/triage-labels.md     五个标准标签及含义
docs/adr/0001-record-decisions.md ADR 起手式
docs/specs/README.md             规格落盘位置与命名
docs/quality-gates.md            五道门定义、证据要求、谁能过
.github/workflows/gates.yml      CI 跑 test/lint/check，红即阻断
.ant/plan.json                   计划种子（可直接喂 team.create）
.ant/team.json                   名册种子：蚁后 1 + 工蚁 N
package.json                     按 --lang 生成，scripts 含 test/lint/check
tests/smoke.test.mjs             一条必过的最小测试，保证 CI 不是空的
.gitignore
```

共 16 个文件。刻意不生成：`.env`、目录层级超过三层的空壳、任何语言的依赖清单（不替用户选包管理器）。

## 3. 占位符与写盘规则

| 占位符 | 来源 |
|---|---|
| `{{name}}` / `{{packageName}}` | `--name`，后者由前者按 `--scope` 推导 |
| `{{summary}}` | `--summary`，缺省取目标目录名 |
| `{{testCommand}}` / `{{lintCommand}}` / `{{checkCommand}}` | 由 `--lang` 决定：node → `node --test`、`npm run lint`、`npm run check:syntax`；none → 全部留空并在文件里写明「尚未配置」 |
| `{{date}}` | 生成当日 ISO 日期 |

写盘规则（全部可测）：
- 目标目录非空且未给 `--force` → 拒绝，列出会新增/会撞名的文件，退出码 2。
- 已存在的文件默认跳过并在结尾列出，不覆盖用户内容。
- 不执行 `git init`、不建远端、不装依赖、不写任何凭据。
- 目录用 `mkdir -p`，文件先写 `<name>.tmp` 再 `rename`，避免半截文件。

## 4. 计划种子

`.ant/plan.json` 是一个可直接提交给 `team.create` 的 plan：

```json
{
  "planId": "{{name}}-v0",
  "mode": "normal",
  "maxActiveAttempts": 4,
  "tasks": [
    { "taskId": "spec",   "title": "写规格",   "objective": "...", "inScope": ["docs/specs"], "outOfScope": [], "acceptance": ["验收项可判真假"], "verify": ["node tools/check-spec.mjs"], "readOnly": false },
    { "taskId": "core",   "title": "实现核心", "objective": "...", "inScope": ["src"],        "outOfScope": [], "acceptance": ["..."], "verify": ["node --test"] },
    { "taskId": "ship",   "title": "集成发布", "objective": "...", "inScope": ["CHANGELOG.md"], "outOfScope": [], "acceptance": ["合并并打 tag"], "verify": ["git log --oneline -1"] }
  ],
  "dependencies": [
    { "taskId": "core", "blockedByTaskId": "spec" },
    { "taskId": "ship", "blockedByTaskId": "core" }
  ],
  "qualityGates": [
    { "gateId": "spec-verify", "taskId": "spec", "kind": "verification", "acceptance": ["规格文件存在且含验收项"] },
    { "gateId": "core-verify", "taskId": "core", "kind": "verification", "acceptance": ["node --test 全绿"] },
    { "gateId": "core-review", "taskId": "core", "kind": "review",       "acceptance": ["独立成员逐条核对 acceptance"] },
    { "gateId": "ship-integration", "taskId": "ship", "kind": "integration", "acceptance": ["合并为单一提交并打 tag"] }
  ]
}
```

CLI 同时把一份现成的 `team.create` 请求体打到 stdout（含 `requestId`、`workspaceRelativePath`、plan、members），可直接粘进 `/ant` 或作为 `ant_team_dispatch` 的 `request` 参数。

## 5. 两处引擎补齐（模板能落地的前提）

### 5.1 验证门：verify 覆盖校验

在 `src/core/decide.mjs:164-167` 的 `task.complete` 分支追加：

```
requireState(everyVerifyCommandHasEvidence(task, payload.evidence), ...)
```

规则：`task.verify` 的每一条字符串，必须在 `payload.evidence` 里存在一条 `kind === 'command'` 且 `locator` 以其开头（允许追加参数）的证据。缺哪几条就在错误消息里逐条列出，便于执行者补。`verify` 为空的旧任务不受影响。

### 5.2 集成门：让 qualityGates 有消费者

- `src/core/codec.mjs`：`quality.review` payload 增可选 `gateId`（向后兼容，老请求不带也通过）。
- `src/core/gate.mjs`：`openReviews(view, plan)` 只输出「该任务的 verification 门已有 pass 记录」的任务；`pendingRelease(view, plan)` 只输出「该任务所有 gate 都有 pass 记录」的任务。
- 影响：`gate.mjs` 三个导出函数签名多一个 `plan` 参数，调用点 `src/host/tool.mjs`、`src/core/autonomy.mjs` 同步；`plan` 缺失时退回旧行为（全放行），保证 0.2.0 的历史团队仍可读。

这一条是**行为变更**：加了 gate 的任务在门没通过前不会进入待放行队列。要做就得连测试一起改，并且明确写在发布说明里。

## 6. 验收

- `tests/core/template.test.mjs`：渲染产物无 `{{` 残留；种子 plan 能过 `validatePlan`；`.ant/plan.json` 的 `verify[0]` 与 `package.json` 的 test script 逐字一致；目标非空时退出码 2；`--force` 下仍不覆盖非模板文件。
- `tests/core/gates-plan.test.mjs`：带 verification gate 的任务在缺证据完成时被拒；补全后放行；gate 未过时 `pendingRelease` 不产出该任务。
- 端到端：临时目录 scaffold → `team.create`（种子）→ dispatch → complete → review pass → `batch.release`，六步全绿。
- 手工：在脚手架产物目录跑一次 `npm test`。

## 7. 不做

- 多语言矩阵（先 `node` 与 `none`，`--lang` 留位；python/rust 等下一轮）
- 面板按钮（下一次更新，落在设置页同一份 `$DSH_HOME/ant.json` 之外，不进 WAL）
- 代建 GitHub 仓库、远端、CI 令牌
- 从模板反向生成规格票（`/to-spec` 已覆盖）

## 8. 实施顺序

1. `src/core/template.mjs` + `tests/core/template.test.mjs`（纯函数，先绿）
2. `tools/ant-scaffold.mjs`（CLI 壳，只做参数解析与写盘）
3. `decide.mjs` 的 verify 覆盖 → `tests/core/gates-plan.test.mjs`
4. `codec.mjs` + `gate.mjs` 的 gate 消费者 → 现有 gate/batch 测试跟改
5. 全量 `node --test --test-concurrency=1`，然后一次 Conventional Commit（`feat(template): ...`），不拆票
