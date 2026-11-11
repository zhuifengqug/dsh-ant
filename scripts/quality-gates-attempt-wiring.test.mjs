// R5 wiring: completion evidence must be bound to the current attempt.
// Loads the real src/tools.ts under Node strip-only type stripping.
// workspace-audit-service.ts uses a TS parameter property that strip-only
// rejects, so that single unrelated module is stubbed (same pattern as
// scripts/no-progress-window.test.mjs).
import test from "node:test"
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const STUB = 'data:text/javascript,' + encodeURIComponent('export const workspaceAuditor = () => ({})')
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier.includes("workspace-audit-service")) return { url: STUB, shortCircuit: true }
  return next(specifier, context)
} })
const { registerAgentTeamsTools } = await import("../src/tools.ts")
const { writeTeam, readTeam } = await import("../src/state.ts")
hook.deregister()

const verificationTask = (overrides = {}) => ({
  id: "v1", subject: "verify", status: "in_progress", dependencies: [],
  createdAt: 0, updatedAt: 0, kind: "verification", attempt: 1,
  attemptId: "att-2", verify: ["pnpm test"], acceptance: ["run passes"], ...overrides,
})
const reviewTask = (overrides = {}) => ({
  id: "r1", subject: "review", status: "in_progress", dependencies: [],
  createdAt: 0, updatedAt: 0, kind: "review", attempt: 1,
  attemptId: "att-2", verdict: "pass", evidenceAttemptId: "att-1", ...overrides,
})
const passedEvidence = {
  acceptanceResults: [{ criterion: "run passes", status: "passed" }],
  commandsRun: [{ command: "pnpm test", status: "passed" }],
}

async function withHarness(initial, run) {
  const workspace = await mkdtemp(join(tmpdir(), "r5-attempt-"))
  const stateDir = ".agent-teams"
  const root = join(workspace, stateDir)
  await mkdir(join(root, "wire"), { recursive: true })
  const team = (task) => ({ id: "wire", name: "wire", captainSessionId: "captain", createdAt: 0, taskSeq: 1, members: [], tasks: [task] })
  await writeTeam(root, team(initial))
  const definitions = new Map()
  const listeners = new Map()
  const captain = { id: "captain", status: "idle", session: { id: "captain", header: { cwd: workspace }, requestHeader() { return {} } } }
  const subagents = {
    async followup() { return "msg" },
    sendMessage() { return "msg" },
    registerContinuableSetup() { return () => {} },
    getProvider() { return undefined },
    list() { return [] },
    async listChildren() { return [] },
    async listDescendants() { return [] },
  }
  const ctx = {
    effect(setup) { return setup() },
    tools: { register(definition) { definitions.set(definition.name, definition) } },
    on(name, listener) { listeners.set(name, [...(listeners.get(name) ?? []), listener]); return () => {} },
    get() { return undefined },
    agents: { get() { return captain }, list() { return [] } },
    logger: { debug() {}, warn() {} },
    llm: { async resolveCallConfig(config) { return config }, async listModels() { return [] } },
    subagents,
  }
  registerAgentTeamsTools(ctx, { stateDir })
  const definition = definitions.get("agent_teams_update_task")
  assert.ok(definition, "agent_teams_update_task must be registered")
  const exec = { agent: captain, signal: new AbortController().signal }
  try {
    return await run({
      call: (args) => definition.execute(args, exec),
      reset: (task) => writeTeam(root, team(task)),
      readTask: async () => (await readTeam(root, "wire")).tasks[0],
    })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

test("update_task 完成证据绑定当前 attempt（真接线）", async (t) => {
  await withHarness(verificationTask(), async (h) => {
    await t.test("缺 attempt_id 带结构化证据被拒收，文案含当前 id 与操作指引", async () => {
      await assert.rejects(
        () => h.call({ task_id: "v1", status: "completed", ...passedEvidence }),
        (error) => {
          assert.match(error.message, /not bound to the current attempt/)
          assert.match(error.message, /Cross-attempt evidence is rejected/)
          assert.match(error.message, /attempt_id="att-2"/)
          assert.ok(error.message.includes("att-2"))
          assert.match(error.message, /Re-run only the failed or missing verify commands/)
          return true
        },
      )
      const task = await h.readTask()
      assert.equal(task.status, "in_progress")
      assert.equal(task.commandsRun, undefined)
      assert.equal(task.evidenceAttemptId, undefined)
    })

    await t.test("跨代 attempt_id 带结构化证据被拒收", async () => {
      await h.reset(verificationTask())
      await assert.rejects(
        () => h.call({ task_id: "v1", status: "completed", attempt_id: "att-old", ...passedEvidence }),
        (error) => {
          assert.match(error.message, /got "att-old", expected "att-2"/)
          assert.match(error.message, /Cross-attempt evidence is rejected/)
          return true
        },
      )
      assert.equal((await h.readTask()).status, "in_progress")
    })

    await t.test("无结构化证据的纯状态更新放行且不打戳", async () => {
      await h.reset(verificationTask())
      const result = await h.call({ task_id: "v1", status: "in_progress" })
      assert.equal(result.status, "in_progress")
      const task = await h.readTask()
      assert.equal(task.evidenceAttemptId, undefined)
      assert.equal(task.status, "in_progress")
    })

    await t.test("当前 attempt 的完整通过证据完成并打戳", async () => {
      await h.reset(verificationTask())
      const result = await h.call({ task_id: "v1", status: "completed", attempt_id: "att-2", ...passedEvidence })
      assert.equal(result.status, "completed")
      const task = await h.readTask()
      assert.equal(task.status, "completed")
      assert.equal(task.evidenceAttemptId, "att-2")
    })

    await t.test("重跑失败命令的最新观察作数，通过命令沿用", async () => {
      await h.reset(verificationTask({ verify: ["a", "b"], acceptance: ["all pass"] }))
      const result = await h.call({
        task_id: "v1", status: "completed", attempt_id: "att-2",
        acceptanceResults: [{ criterion: "all pass", status: "passed" }],
        commandsRun: [
          { command: "a", status: "passed" },
          { command: "b", status: "failed" },
          { command: "b", status: "passed" },
        ],
      })
      assert.equal(result.status, "completed")
      const task = await h.readTask()
      assert.deepEqual(task.commandsRun.map((row) => row.command), ["a", "b", "b"])
      assert.equal(task.evidenceAttemptId, "att-2")
    })

    await t.test("上一代记录的通过证据不能带当前代完成，durable state 不被写坏", async () => {
      await h.reset(verificationTask({ attemptId: "att-3", evidenceAttemptId: "att-2", ...passedEvidence }))
      await assert.rejects(
        () => h.call({ task_id: "v1", status: "completed", attempt_id: "att-3" }),
        (error) => {
          assert.match(error.message, /previous attempt/)
          assert.match(error.message, /attempt_id="att-3"/)
          return true
        },
      )
      const task = await h.readTask()
      assert.equal(task.status, "in_progress")
      assert.equal(task.evidenceAttemptId, "att-2")
    })

    await t.test("本代重交证据后完成并把戳刷新到当前 attempt", async () => {
      await h.reset(verificationTask({ attemptId: "att-3", evidenceAttemptId: "att-2", ...passedEvidence }))
      const result = await h.call({ task_id: "v1", status: "completed", attempt_id: "att-3", ...passedEvidence })
      assert.equal(result.status, "completed")
      assert.equal((await h.readTask()).evidenceAttemptId, "att-3")
    })

    await t.test("review 类上一代 verdict 拒收，重交 verdict=pass 后完成", async () => {
      await h.reset(reviewTask())
      await assert.rejects(
        () => h.call({ task_id: "r1", status: "completed", attempt_id: "att-2" }),
        (error) => {
          assert.match(error.message, /previous attempt/)
          assert.match(error.message, /verdict=pass/)
          return true
        },
      )
      const result = await h.call({ task_id: "r1", status: "completed", attempt_id: "att-2", verdict: "pass", findings: [] })
      assert.equal(result.status, "completed")
      assert.equal((await h.readTask()).evidenceAttemptId, "att-2")
    })

    await t.test("验证覆盖失败只点名失败或缺失命令，并提示通过结果沿用不重跑", async () => {
      await h.reset(verificationTask({ verify: ["a", "b"], acceptance: ["x"] }))
      await assert.rejects(
        () => h.call({
          task_id: "v1", status: "completed", attempt_id: "att-2",
          acceptanceResults: [{ criterion: "x", status: "passed" }],
          commandsRun: [{ command: "a", status: "passed" }],
        }),
        (error) => {
          assert.match(error.message, /Re-run only these failed or missing verify commands/)
          assert.match(error.message, /"b"/)
          assert.ok(!error.message.includes("\"a\""), "already-passed command must not be listed for re-run")
          assert.match(error.message, /Commands whose latest observation passed are carried forward and must not be re-run/)
          return true
        },
      )
    })

    await t.test("work 类任务不受证据绑定校验影响", async () => {
      await h.reset(verificationTask({ kind: "work" }))
      const result = await h.call({ task_id: "v1", status: "completed" })
      assert.equal(result.status, "completed")
    })
  })
})
