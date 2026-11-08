# 玄驹仓库模板：需求→实现→验证→审查→集成 五道门脚手架

状态：已实施（2026-11-08）。基线 `@zhuifengqug/dsh-ant@0.2.0`。本文描述生成器的最终形态、模板文件清单、门与 ant 既有结构的映射，以及两处引擎缺口是怎么补上的。

## 0. 结论先行

1. **模板不是一组文件，是三件东西**：文件骨架（`src/core/template.mjs`）+ 计划种子（`seedPlan`）+ 写盘入口（`tools/ant-scaffold.mjs`）。只交文件等于交纸门。
2. **五道门现在都有执行者**：需求 = `task.objective/acceptance`，实现 = `attempt`，验证 = `task.complete` 的 verify 覆盖校验，审查 = `quality.review`，集成 = `batch.release` + `openIntegration` 查询面。
3. **补齐的两个缺口**（改动都在既有动作内部，没加事件类型、没加动作）:
   - `task.complete` 原来只要求 `evidence.length > 0`，现在要求 `task.verify[]` 每条命令都有对应的 `kind="command"` 证据。
   - `plan.qualityGates` 原来只在 `validatePlan` 里被校验、没有消费者，现在由 `gateStatus` 判定，并被 `batch.release` 与面板查询共用。
4. 交付：`src/core/template.mjs`、`tools/ant-scaffold.mjs`、`tests/core/template.test.mjs`、`tests/core/gates-plan.test.mjs`，外加 `src/core/gate.mjs`、`src/core/decide.mjs`、`src/core/codec.mjs` 的补齐。全量 92 tests / 92 pass。

## 1. 五道门 ↔ 既有结构

| 门 | 谁执行 | ant 里的载体 | 判定条件 | 现状 |
|---|---|---|---|---|
| 1 需求 | 人 + 蚁后 | `goal`、`tasks[].objective/acceptance`、规格票 | acceptance 非空且能追溯到规格票 | 已有（`codec.mjs` 必填 acceptance/verify） |
| 2 实现 | 工蚁 | `attempt.dispatch` → `attempt.admitted` | attempt 处于 running | 已有（`src/core/scheduler.mjs`） |
| 3 验证 | 执行者 + 机器 | `tasks[].verify[]` + `task.complete.evidence` | verify 每条都有 `kind="command"` 证据，locator 命中 | **本仓补齐**（`decide.mjs` `uncoveredVerify`） |
| 4 审查 | 独立成员 | `quality.review` | reviewer 不在该任务 attempts 里，criteria 非空，gate 归属正确 | 已有 + **本仓补齐 gate 归属** |
| 5 集成 | 人（L2 批量放行） | `batch.release` → merge + tag | 放行前：非集成门全满足；放行后：`openIntegration` 列出未核对的集成门 | **本仓补齐** |

要点：门不是新机制，是把已经存在的事件串成一条不许跳的链。模板的职责是让这条链在新仓库里**默认存在**，而不是事后补文档。

## 2. 生成与用法

```bash
node tools/ant-scaffold.mjs --target ../my-repo --name my-repo --scope @acme --summary "一句话目标"
# 或：npm run scaffold -- --name my-repo --lang none
```

选项：`--target`（默认 `./<name>`）、`--name`、`--scope`、`--summary`、`--lang node|none`（默认 node）、`--force`、`--help`。

标准输出是最小化的 `team.create` 请求体（`requestId`、`action`、`payload.goal`、`payload.plan`、`payload.members`），可直接作为 `ant_team_dispatch` 的 `request`；人类可读的进度写在 stderr，所以 `> req.json` 拿到的是纯 JSON。

## 3. 模板文件清单（`--lang node`，共 15 个）

```
AGENTS.md                       项目工作规则：先方案后改动、提交规范、测试前置
README.md                       一句话定位 + 安装 + 目录地图
GLOSSARY.md                     术语表（领域词在此收口）
.gitignore
docs/agents/domain.md           单上下文领域说明
docs/agents/issue-tracker.md    issue 载体与操作方式
docs/agents/triage-labels.md    五个标准标签及含义
docs/adr/0001-record-decisions.md  ADR 起手式
docs/specs/README.md            规格落盘位置与命名
docs/quality-gates.md           五道门定义、证据要求、谁能过
.ant/plan.json                  计划种子（可直接喂 team.create）
.ant/team.json                  名册种子：蚁后 1 + 工蚁 2
package.json                    按 --lang 生成，scripts 含 test/lint/check:syntax
tests/smoke.test.mjs            一条必过的最小测试，保证 CI 不是空的
.github/workflows/gates.yml     CI 跑 test/lint/check，红即阻断
```

`--lang none` 去掉最后三个（`package.json`、`tests/smoke.test.mjs`、`.github/workflows/gates.yml`），其余 12 个保留，测试命令留空并写明「尚未配置」。刻意不生成：`.env`、超过三层的空目录、任何语言的依赖清单（不替用户选包管理器）。

## 4. 占位符与写盘规则

| 占位符 | 来源 |
|---|---|
| `{{name}}` / `{{packageName}}` | `--name`，后者按 `--scope` 推导为 `@scope/name` |
| `{{summary}}` | `--summary`，缺省取 `--name` |
| `{{testCommand}}` / `{{lintCommand}}` / `{{checkCommand}}` / `{{integrationCommand}}` | 由 `--lang` 决定 |
| `{{date}}` | 生成当日 ISO 日期 |

渲染器 `render(text, vars)` 遇到未知占位符直接抛错（`Unknown scaffold placeholder: <key>`），CLI 在写盘前再用一遍正则兜底，所以产物里不会留 `{{…}}`。

写盘规则（全部有测试）：
- 目标目录非空且未给 `--force` → 退出码 2，逐行列出会撞名的文件，一个字节都不写。
- 给 `--force` 时：模板文件覆盖，非模板文件（例如自己的 `NOTES.md`）不动。
- 目录 `mkdir -p`；文件先写 `<file>.tmp-<pid>` 再 `rename`，不留半截文件。
- 不执行 `git init`、不建远端、不装依赖、不写任何凭据。

## 5. 计划种子

`seedPlan()` 产出的 `.ant/plan.json` 与 `teamCreateRequest()` 里的 `payload.plan` 是同一份对象：

```json
{
  "planId": "<name>-v0",
  "mode": "normal",
  "maxActiveAttempts": 4,
  "tasks": [
    { "taskId": "spec", "title": "写规格",   "objective": "把目标写成可判真假的验收项，落盘到 docs/specs/", "inScope": ["docs/specs"], "outOfScope": ["src"],       "acceptance": ["规格文件存在且每条验收项都能判真假"], "verify": [] },
    { "taskId": "core", "title": "实现",     "objective": "按规格实现，改动留在 inScope 之内",             "inScope": ["src", "tests"], "outOfScope": ["docs/adr"], "acceptance": ["规格里的验收项逐条满足"],           "verify": ["node --test"] },
    { "taskId": "ship", "title": "集成发布", "objective": "合并、跑全量测试并留一条可追溯的提交",         "inScope": ["CHANGELOG.md"], "outOfScope": ["src"],      "acceptance": ["全量测试通过", "提交信息符合规范"],  "verify": ["git log --oneline -1"] }
  ],
  "dependencies": [
    { "taskId": "core", "blockedByTaskId": "spec" },
    { "taskId": "ship", "blockedByTaskId": "core" }
  ],
  "qualityGates": [
    { "gateId": "spec-verification", "taskId": "spec", "kind": "verification", "acceptance": ["规格文件存在且含验收项"] },
    { "gateId": "core-verification", "taskId": "core", "kind": "verification", "acceptance": ["node --test 全绿"] },
    { "gateId": "core-review",       "taskId": "core", "kind": "review",       "acceptance": ["独立成员逐条核对 acceptance"] },
    { "gateId": "ship-integration",  "taskId": "ship", "kind": "integration",  "acceptance": ["合并为单一提交并打 tag"] }
  ]
}
```

名册种子 `seedMembers()`：`queen`（蚁后）+ `worker-1`/`worker-2`（工蚁），`sessionMode: "persistent"`，provider/model 可覆盖。审查者必须不是该任务的 claimant，所以至少两名成员才有自动化审查去向；只有一名成员时 `reviewAssignment` 会返回 `intervention: true`（交人）。

## 6. 两处引擎补齐（已实施）

### 6.1 验证门：verify 覆盖校验

`src/core/decide.mjs` 的 `task.complete` 分支：

```
const uncovered = uncoveredVerify(task(payload.taskId), payload.evidence);
requireState(uncovered.length === 0, 'Completion is missing verify evidence: ' + uncovered.join(' | '));
```

`uncoveredVerify` 的判定：`task.verify` 的每一条字符串，必须在 `evidence` 里存在一条 `kind === "command"` 且 `locator === 命令` 或 `locator.startsWith(命令 + " ")` 的记录（允许追加参数）。缺哪几条就在错误消息里逐条列出。`verify` 为空的旧任务不受影响。

### 6.2 门的消费者：`src/core/gate.mjs`

| 导出 | 语义 |
|---|---|
| `reviewAssignment(view, taskId)` | 谁该审这个任务；无人可审时 `intervention: true` |
| `gateStatus(view, plan, taskId)` | 返回 `{ gates: [{gateId, kind, satisfied}], pending }`。verification 门由 `task.selfCompleted` 满足（因为 6.1 保证自完成必须带证据）；review 门由 pass 审查满足；integration 门只要没记录就仍是 pending |
| `openReviews(view, plan)` | 待审任务；给了 plan 就附带 `pendingGates` |
| `pendingRelease(view, plan)` | 只输出「除 integration 外所有门都已满足」的 reviewed 任务 |
| `blockedRelease(view, plan)` | 被门挡住、暂时不能放行的 reviewed 任务及其 `pendingGates`，面板用它解释「为什么这单还没进待放行」 |
| `openIntegration(view, plan)` | 已放行但集成门未记录的 `{ taskId, pendingGates }`，归档前的人工核对清单 |
| `withGateQueues(view)` | 把上面三个队列挂到视图上（`releaseQueue` / `blockedRelease` / `integrationQueue`），`TeamActionService.get` 统一调用 |

不传 `plan` 时全部退回 0.2.0 的行为（不按门过滤），所以历史团队仍可读。

面板不再自己算放行队列：`client.js` 的 `pendingReleaseTasks(view)` 直接读 `view.releaseQueue`，巢门大厅与侧栏徽标因此共用同一份判定，被门挡住的单子由 `view.blockedRelease` 说明原因。

### 6.3 门的归属与状态约束

- `quality.review` 可带可选 `gateId`（`codec.mjs` 已放开）。带了就必须属于该任务且 `kind === "review"`，否则 `Review gate does not belong to this task`。
- 任务声明了 2 个以上 review 门时，审查必须写 `gateId`（`Review must name its gate when the task declares several`）；只有一个 review 门时可以省略，未署名的 pass 视为满足它。
- 已 `released` / `archived` 的任务不再接受审查（`Review is closed for a released task`）：pass 审查会把任务状态写回 `reviewed`，等于把发布退回去。
- `batch.release` 对每个 taskId 检查非集成门是否全满足，否则 `Release is blocked by open gates: <gateId> | …`。
- **集成门是查询面，不是阻断器**：集成发生在放行之后，若在放行前强制它，任何计划都永远放不出去。所以放行只拦「验证 + 审查」，`openIntegration` 负责让「放行了但还没合并」这件事可见；归档本来要求全部 attempt 已 terminate，人工核对在这一步收口。

## 7. 验收（已执行）

- `tests/core/template.test.mjs`（6 例）：node 模板 15 个文件且无 `{{` 残留、路径不重复、`package.json` 的 name 按 scope 推导、tests script 为 `node --test`；none 模板 12 个文件；种子 plan 过 `validatePlan` 且 verify 里的非 git 命令都能在生成的 scripts 里找到；非空目录退出码 2 且不落盘；空目录生成 15 个文件并从 stdout 打印 `team.create`；`--force` 覆盖 `AGENTS.md` 但保留 `NOTES.md`。
- `tests/core/gates-plan.test.mjs`（4 例）：缺 `npm run lint` 证据的 complete 被拒并在消息里点名；补齐后 `selfCompleted` 为真且 `gateStatus.pending` 剩审查与集成门；两道审查门逐条通过后 `pendingRelease` 才产出、`blockedRelease` 才清空、`batch.release` 通过、`openIntegration` 列出集成门；把号型不对的 gateId（integration、verification）或未署名的审查交给多门任务会被拒。
- 全量：`node --test --test-concurrency=1`，16 个测试文件，92 tests / 92 pass。
- 手工冒烟（本机执行）：CLI 在临时目录生成 15 个文件、`requestId demo-create-2026-11-08`、members 为 `queen/蚁后 worker-1/工蚁 worker-2/工蚁`，第二次不带 `--force` 退出码 2。

## 8. 不做

- 多语言矩阵（先 `node` 与 `none`，`--lang` 留位；python/rust 等下一轮）
- 面板上的「新建仓库」按钮（落在设置页，另开票）
- 代建 GitHub 仓库、远端、CI 令牌
- 从模板反向生成规格票（`/to-spec` 已覆盖）
