/** Repository scaffold for a five-gate team: files, plan seed and roster seed. Pure strings, no I/O. */

const LANGUAGES = new Set(['node', 'none']);

export const PLACEHOLDER = /\{\{([a-z][a-z0-9]*)\}\}/gi;

/** Render every {{name}} from vars; an unknown placeholder is an error, never a silent blank. */
export function render(text, vars) {
  return String(text).replace(PLACEHOLDER, (_match, key) => {
    const value = vars[key];
    if (typeof value !== 'string') throw new Error('Unknown scaffold placeholder: ' + key);
    return value;
  });
}

function varsOf(options) {
  const name = String(options.name ?? '').trim();
  if (!name) throw new Error('name is required');
  const lang = options.lang ?? 'node';
  if (!LANGUAGES.has(lang)) throw new Error('lang must be one of: ' + [...LANGUAGES].join(', '));
  const packageName = options.packageName ?? (options.scope ? options.scope.replace(/\/$/, '') + '/' + name : name);
  const testCommand = lang === 'node' ? 'node --test' : '';
  return {
    name,
    packageName,
    summary: String(options.summary ?? name),
    date: options.date ?? new Date().toISOString().slice(0, 10),
    lang,
    testCommand,
    lintCommand: lang === 'node' ? 'npm run lint --silent' : '',
    checkCommand: lang === 'node' ? 'npm run check:syntax --silent' : '',
    integrationCommand: 'git log --oneline -1',
  };
}

const AGENTS = `# {{name}} 的工作规则

这是给在这个仓库里干活的 agent 看的。人看的那份在 README.md。

## 开工前

1. 先读 \`docs/agents/\` 下的三份：领域说明、issue 约定、标签含义。
2. 任何改动先给方案再动手；只读排查不受限。
3. 一次只推进一个任务，任务状态以 issue 为准，不以对话里的说法为准。

## 提交

- Conventional Commits：\`feat:\` / \`fix:\` / \`docs:\` / \`test:\` / \`chore:\`。
- 一个提交只做一件事；提交信息写清「为什么」，不写「改了哪些文件」。
- 禁 force-push，禁改写已推送的历史。

## 完成之前

- \`{{testCommand}}\` 必须绿。
- 五道门见 \`docs/quality-gates.md\`：需求 → 实现 → 验证 → 审查 → 集成，任何一道没证据都不算完成。
`;

const README = `# {{name}}

{{summary}}

## 安装

\`\`\`
npm install
\`\`\`

## 开发

\`\`\`
{{testCommand}}
\`\`\`

## 目录

| 路径 | 作用 |
|---|---|
| \`docs/agents/\` | 给 agent 的上下文：领域、issue、标签 |
| \`docs/adr/\` | 架构决策记录 |
| \`docs/specs/\` | 规格与验收项 |
| \`docs/quality-gates.md\` | 五道门的定义与证据要求 |
| \`.ant/\` | 玄驹团队的计划种子与名册种子 |
`;

const GLOSSARY = `# 术语表

一个词只留一个说法。发现同物异名先在这里收口，再改代码。

| 术语 | 含义 | 避免 |
|---|---|---|
| {{name}} | 本仓库 | — |
`;

const DOMAIN = `# 领域说明

单上下文仓库：所有代码共享一套领域语言。

## 边界

- 做：{{summary}}
- 不做：（逐条列出排除项，写清为什么不在这里做）

## 关键概念

| 概念 | 一句话定义 | 落在哪 |
|---|---|---|
`;

const ISSUE_TRACKER = `# Issue 约定

- 载体：GitHub Issues。
- 一个 issue 一件事；超过一天的活先拆票。
- 规格写进 issue 正文，验收项用可判真假的句子，不用「体验良好」这类形容词。
- 关闭 issue 必须留证据：测试命令与输出、提交号，或链接到落盘文件。
`;

const TRIAGE = `# 标签

五个角色标签，一个 issue 最多一个：

| 标签 | 含义 |
|---|---|
| \`needs-triage\` | 还没人看过 |
| \`needs-info\` | 缺信息，等人补 |
| \`ready-for-agent\` | 可以交给 agent 做 |
| \`ready-for-human\` | 必须人做 |
| \`wontfix\` | 决定不做 |
`;

const ADR = `# 1. 记录架构决策

日期：{{date}}

## 状态

已接受

## 背景

（是什么问题逼出了这个决策；不写方案，只写约束。）

## 决策

（一句话说清选了哪条路。）

## 后果

（选了它之后，哪些事变容易了，哪些事变难了。）
`;

const SPECS = `# 规格

命名：\`YYYY-MM-DD-<主题>.md\`。一份规格对应一个 issue。

正文至少包含：目标、验收项（可判真假）、不做的事、涉及的模块。
`;

const GATES = `# 五道门

任何任务要算完成，五道门依次通过；顺序不能跳。

| 门 | 谁把关 | 要什么证据 | 怎么记录 |
|---|---|---|---|
| 1 需求 | 人 | 规格文件 + 可判真假的验收项 | \`docs/specs/\` 里的文件 |
| 2 实现 | 工蚁 | 改动本身 | 提交 |
| 3 验证 | 机器 | 每条 verify 命令都跑过 | \`task.complete\` 的 \`evidence\`：\`kind: "command"\`，\`locator\` 就是命令 |
| 4 审查 | 独立成员（不是这条任务的执行者） | 逐条核对验收项 | \`quality.review\`：\`verdict: "pass"\`，\`criteria\` 非空 |
| 5 集成 | 人 | 合并 + 打 tag | 放行后的提交记录 |

在玄驹里，这五道门对应 \`.ant/plan.json\` 的 \`tasks[].verify\` 与 \`qualityGates\`：

- \`kind: "verification"\` 的门由第 3 门的机器证据满足：verify 全覆盖才算完成；
- \`kind: "review"\` 的门要一条 \`quality.review\` 通过，审查者不能是该任务的执行者；
- \`kind: "integration"\` 的门在放行之后、归档之前核对，用 \`gateId\` 记录。

缺证据就是没完成，不看「差不多做完了」。
`;

const WORKFLOW = `name: gates

on:
  push:
    branches: [master]
  pull_request:

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: {{testCommand}}
`;

const GITIGNORE = `node_modules/
dist/
*.log
.env
.env.*
.DS_Store
`;

const SMOKE = `import test from 'node:test';
import assert from 'node:assert/strict';

test('the suite runs at all', () => {
  assert.equal(1 + 1, 2);
});
`;

const PACKAGE = `{
  "name": "{{packageName}}",
  "version": "0.0.0",
  "private": true,
  "description": "{{summary}}",
  "type": "module",
  "scripts": {
    "test": "{{testCommand}}",
    "lint": "node --check src/index.js",
    "check:syntax": "node --check src/index.js"
  }
}
`;

/** The five gates as a plan the Host accepts: three tasks, one chain, four gates. */
export function seedPlan(options) {
  const vars = varsOf(options);
  const verify = command => (command ? [command] : []);
  return {
    planId: vars.name + '-v0',
    mode: 'normal',
    maxActiveAttempts: 4,
    tasks: [
      {
        taskId: 'spec',
        title: '写规格',
        objective: '把目标写成可判真假的验收项，落盘到 docs/specs/',
        inScope: ['docs/specs'],
        outOfScope: ['src'],
        acceptance: ['规格文件存在且每条验收项都能判真假'],
        verify: [],
      },
      {
        taskId: 'core',
        title: '实现',
        objective: '按规格实现，改动留在 inScope 之内',
        inScope: ['src', 'tests'],
        outOfScope: ['docs/adr'],
        acceptance: ['规格里的验收项逐条满足'],
        verify: verify(vars.testCommand),
      },
      {
        taskId: 'ship',
        title: '集成',
        objective: '合并为单一提交、跑一遍全量测试、打 tag',
        inScope: ['CHANGELOG.md'],
        outOfScope: [],
        acceptance: ['合并完成且 tag 指向合并后的提交'],
        verify: [vars.integrationCommand],
      },
    ],
    dependencies: [
      { taskId: 'core', blockedByTaskId: 'spec' },
      { taskId: 'ship', blockedByTaskId: 'core' },
    ],
    qualityGates: [
      { gateId: 'spec-verification', taskId: 'spec', kind: 'verification', acceptance: ['规格文件存在且验收项非空'] },
      { gateId: 'core-verification', taskId: 'core', kind: 'verification', acceptance: ['测试命令全绿'] },
      { gateId: 'core-review', taskId: 'core', kind: 'review', acceptance: ['独立成员逐条核对验收项'] },
      { gateId: 'ship-integration', taskId: 'ship', kind: 'integration', acceptance: ['合并为单一提交并打 tag'] },
    ],
  };
}

/** Roster seed: one queen and two workers, Chinese roles on ASCII identities. */
export function seedMembers(options = {}) {
  const provider = options.provider ?? 'deepseek';
  const model = options.model ?? 'deepseek-v4';
  const member = (memberId, role) => ({
    memberId, role, sessionMode: 'persistent', provider, model,
    inScope: ['.'], outOfScope: [],
  });
  return [member('queen', '蚁后'), member('worker-1', '工蚁'), member('worker-2', '工蚁')];
}

/** The exact team.create request body, ready to paste into /ant or ant_team_dispatch. */
export function teamCreateRequest(options) {
  const vars = varsOf(options);
  return {
    requestId: vars.name + '-create-' + vars.date,
    action: 'team.create',
    payload: {
      goal: vars.summary,
      workspaceRelativePath: '.',
      plan: seedPlan(options),
      members: seedMembers(options),
    },
  };
}

/** Every file the scaffold writes, in a fixed order. */
export function scaffoldFiles(options) {
  const vars = varsOf(options);
  const files = [
    ['AGENTS.md', AGENTS],
    ['README.md', README],
    ['GLOSSARY.md', GLOSSARY],
    ['.gitignore', GITIGNORE],
    ['docs/agents/domain.md', DOMAIN],
    ['docs/agents/issue-tracker.md', ISSUE_TRACKER],
    ['docs/agents/triage-labels.md', TRIAGE],
    ['docs/adr/0001-record-decisions.md', ADR],
    ['docs/specs/README.md', SPECS],
    ['docs/quality-gates.md', GATES],
    ['.ant/plan.json', JSON.stringify(seedPlan(options), null, 2) + '\n'],
    ['.ant/team.json', JSON.stringify({ members: seedMembers(options) }, null, 2) + '\n'],
  ];
  if (vars.lang === 'node') {
    files.push(['package.json', PACKAGE]);
    files.push(['tests/smoke.test.mjs', SMOKE]);
    files.push(['.github/workflows/gates.yml', WORKFLOW]);
  }
  return files.map(([path, text]) => ({ path, contents: render(text, vars) }));
}
