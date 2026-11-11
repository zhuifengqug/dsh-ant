// R4: sliding no-progress window (observation only).
// Loads the real src/snapshot.ts under Node's default strip-only type
// stripping. workspace-audit-service.ts uses a TS parameter property that
// strip-only mode rejects, so that single unrelated module is stubbed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier.includes('workspace-audit-service')) {
    const source = 'export const workspaceAuditor = () => ({ audit: async () => { throw new Error("workspace audit stub must not run") } })'
    return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
  }
  return next(specifier, context)
} })
const {
  assembleTeamSnapshot,
  DEFAULT_NO_PROGRESS_WINDOW_MS,
  resolveNoProgressWindowMs,
  lastActivityAtOf,
  detectNoProgress,
} = await import('../src/snapshot.ts')
const { writeTeam, readTeam, CAPTAIN_KEY } = await import('../src/state.ts')
hook.deregister()

const NOW = 1_700_000_000_000
const WINDOW = 60_000

const baseTask = (overrides = {}) => ({
  id: 't1', subject: 'Task t1', status: 'in_progress', assignee: 'worker',
  dependencies: [], createdAt: NOW - WINDOW, updatedAt: NOW - WINDOW, ...overrides,
})
const baseState = (overrides = {}) => ({
  id: 'test', name: 'Test', captainSessionId: 'captain', createdAt: NOW - 10_000,
  taskSeq: 1,
  members: [{ id: 'member', name: 'worker', status: 'working', joinedAt: NOW - 10_000 }],
  tasks: [baseTask()],
  ...overrides,
})
const report = (ts, overrides = {}) => ({
  id: `m-${ts}`, from: 'worker', to: CAPTAIN_KEY, content: 'progress', ts, ...overrides,
})

// Build a durable team on disk, project it, and prove the projection wrote
// nothing back. Every wiring test goes through this helper.
async function project(t, state, options = {}, inboxMessages = []) {
  const root = await mkdtemp(join(tmpdir(), 'noprogress-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, state.id, 'inbox'), { recursive: true })
  if (inboxMessages.length > 0) {
    await writeFile(join(root, state.id, 'inbox', `${CAPTAIN_KEY}.jsonl`),
      inboxMessages.map((message) => JSON.stringify(message)).join('\n') + '\n')
  }
  await writeTeam(root, state)
  const ctx = { agents: { get: () => ({ status: 'running' }) }, logger: { warn() {} } }
  const before = await readTeam(root, state.id)
  const projected = await assembleTeamSnapshot(ctx, root, root, before, options)
  assert.deepEqual(await readTeam(root, state.id), before, 'projection must not mutate durable state')
  return { root, before, projected }
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

test('窗口解析：option > state > default，非法值回退默认', () => {
  assert.equal(DEFAULT_NO_PROGRESS_WINDOW_MS, 300_000)
  assert.equal(resolveNoProgressWindowMs({ noProgressWindowMs: 1_000 }, { noProgressWindowMs: 2_000 }), 1_000)
  assert.equal(resolveNoProgressWindowMs({}, { noProgressWindowMs: 2_000 }), 2_000)
  assert.equal(resolveNoProgressWindowMs({}, {}), DEFAULT_NO_PROGRESS_WINDOW_MS)
  for (const bad of [0, -1, NaN, Infinity]) {
    assert.equal(resolveNoProgressWindowMs({ noProgressWindowMs: bad }, {}), DEFAULT_NO_PROGRESS_WINDOW_MS)
  }
})

test('活动锚点取最新，且不混入其它成员的输出', () => {
  const task = { updatedAt: 1_000, assignee: 'worker' }
  assert.equal(lastActivityAtOf(task, []), 1_000)
  assert.equal(lastActivityAtOf(task, [
    { from: 'worker', ts: 3_000 }, { from: 'other', ts: 9_999 }, { from: 'worker', ts: 2_000 },
  ]), 3_000)
  assert.equal(lastActivityAtOf(task, [], 5_000), 5_000)
  assert.equal(lastActivityAtOf({ updatedAt: 1_000, assignee: '' }, [{ from: 'worker', ts: 3_000 }]), 1_000)
  assert.equal(lastActivityAtOf({ updatedAt: 1_000 }, [{ from: 'worker', ts: 3_000 }]), 1_000)
  assert.equal(lastActivityAtOf({ updatedAt: NaN, assignee: 'worker' }, [{ from: 'worker', ts: NaN }]), 0)
})

test('窗口内不标记：未超窗的 running 任务不产生无进展标记', () => {
  const inside = detectNoProgress({ status: 'in_progress', lastActivityAt: NOW - WINDOW + 1, now: NOW, windowMs: WINDOW })
  assert.equal(inside.noProgress, false)
  const exact = detectNoProgress({ status: 'in_progress', lastActivityAt: NOW - WINDOW, now: NOW, windowMs: WINDOW })
  assert.equal(exact.noProgress, false, 'exactly at the boundary is not "over" the window')
})

test('活动后窗口重置：新输出把锚点前移后标记消失', () => {
  const status = 'in_progress'
  const before = detectNoProgress({ status, lastActivityAt: NOW - WINDOW - 5_000, now: NOW, windowMs: WINDOW })
  assert.equal(before.noProgress, true)
  const anchor = lastActivityAtOf(
    { updatedAt: NOW - WINDOW - 5_000, assignee: 'worker' },
    [{ from: 'worker', ts: NOW - 1_000 }],
  )
  assert.equal(anchor, NOW - 1_000)
  const after = detectNoProgress({ status, lastActivityAt: anchor, now: NOW, windowMs: WINDOW })
  assert.equal(after.noProgress, false)
  assert.equal(after.noProgressForMs, 1_000)
})

test('超窗且 running 才标记，并给出真实无进展时长', () => {
  const result = detectNoProgress({ status: 'in_progress', lastActivityAt: NOW - WINDOW - 2_000, now: NOW, windowMs: WINDOW })
  assert.equal(result.noProgress, true)
  assert.equal(result.noProgressForMs, WINDOW + 2_000)
})

test('非 running 状态不标记，claimed 视为 running', () => {
  const stalled = { lastActivityAt: NOW - WINDOW - 1, now: NOW, windowMs: WINDOW }
  for (const status of ['pending', 'completed', 'failed', 'cancelled']) {
    assert.equal(detectNoProgress({ ...stalled, status }).noProgress, false, status)
  }
  assert.equal(detectNoProgress({ ...stalled, status: 'claimed' }).noProgress, true)
})

test('无效时间戳或窗口时保守地不标记', () => {
  const stalled = { status: 'in_progress', lastActivityAt: NOW - WINDOW - 1, now: NOW, windowMs: WINDOW }
  assert.equal(detectNoProgress({ ...stalled, lastActivityAt: 0 }).noProgress, false)
  assert.equal(detectNoProgress({ ...stalled, now: NaN }).noProgress, false)
  assert.equal(detectNoProgress({ ...stalled, windowMs: 0 }).noProgress, false)
})

// ---------------------------------------------------------------------------
// Wiring through the existing snapshot refresh path
// ---------------------------------------------------------------------------

test('投影：窗口内不标记（不引入 noProgress 字段）', async (t) => {
  const state = baseState({ tasks: [baseTask({ updatedAt: NOW - WINDOW + 1_000 })] })
  const { projected } = await project(t, state, { now: NOW, noProgressWindowMs: WINDOW })
  assert.equal(projected.tasks[0].noProgress, undefined)
  assert.equal('noProgress' in projected.tasks[0], false)
  assert.equal('noProgressForMs' in projected.tasks[0], false)
})

test('投影：活动后窗口重置（已读成员报告把锚点前移）', async (t) => {
  const old = NOW - WINDOW - 5_000
  const state = baseState({ tasks: [baseTask({ updatedAt: old })] })
  const stalled = await project(t, state, { now: NOW, noProgressWindowMs: WINDOW })
  assert.equal(stalled.projected.tasks[0].noProgress, true)
  // A read-at report is still durable activity: the full captain mailbox is
  // read, not the unread-only preview.
  const reset = await project(t, state, { now: NOW, noProgressWindowMs: WINDOW }, [
    report(NOW - 1_000, { readAt: NOW - 500 }),
  ])
  assert.equal(reset.projected.tasks[0].noProgress, undefined)
  assert.equal('noProgressForMs' in reset.projected.tasks[0], false)
})

test('投影：超窗 running 才标记，不改状态/顺序/派发，只影响投影', async (t) => {
  const old = NOW - WINDOW - 10_000
  const state = baseState({ taskSeq: 4, tasks: [
    baseTask({ id: 't1', updatedAt: old, status: 'in_progress', assignee: 'worker' }),
    baseTask({ id: 't2', updatedAt: old, status: 'pending', assignee: '' }),
    baseTask({ id: 't3', updatedAt: old, status: 'claimed', assignee: 'worker' }),
    baseTask({ id: 't4', updatedAt: old, status: 'completed', assignee: 'worker' }),
  ] })
  const { projected, before } = await project(t, state, { now: NOW, noProgressWindowMs: WINDOW })
  assert.deepEqual(projected.tasks.map((task) => task.id), ['t1', 't2', 't3', 't4'], 'task order unchanged')
  assert.deepEqual(projected.tasks.map((task) => task.status), ['in_progress', 'pending', 'claimed', 'completed'])
  assert.deepEqual(projected.tasks.map((task) => task.state), ['running', 'open', 'claimed', 'completed'])
  assert.equal(projected.tasks[0].noProgress, true)
  assert.equal(projected.tasks[0].noProgressForMs, NOW - old)
  assert.equal(projected.tasks[1].noProgress, undefined, 'pending is not running')
  assert.equal(projected.tasks[2].noProgress, true, 'claimed is running')
  assert.equal(projected.tasks[3].noProgress, undefined, 'terminal is not running')
  assert.deepEqual(before.tasks.map((task) => task.status), ['in_progress', 'pending', 'claimed', 'completed'])
  assert.equal(before.tasks[0].noProgress, undefined, 'durable task never gains the projection-only field')
})

test('投影：默认窗口与 TeamState.noProgressWindowMs 覆盖生效', async (t) => {
  const farOld = NOW - DEFAULT_NO_PROGRESS_WINDOW_MS - 1
  const withDefault = await project(t, baseState({ tasks: [baseTask({ updatedAt: farOld })] }), { now: NOW })
  assert.equal(withDefault.projected.tasks[0].noProgress, true, 'default 5-minute window is applied')

  const old = NOW - 120_000
  const wideTeam = await project(t, baseState({ tasks: [baseTask({ updatedAt: old })], noProgressWindowMs: 600_000 }), { now: NOW })
  assert.equal(wideTeam.projected.tasks[0].noProgress, undefined, 'per-team wide window suppresses the mark')
  assert.equal('noProgress' in wideTeam.projected.tasks[0], false)

  const optionWins = await project(t, baseState({ tasks: [baseTask({ updatedAt: old })], noProgressWindowMs: 600_000 }), { now: NOW, noProgressWindowMs: 10_000 })
  assert.equal(optionWins.projected.tasks[0].noProgress, true, 'snapshot option overrides the per-team value')
})

test('投影：historic 归档跳过检测；halted 团队仍按窗口标记且不改状态', async (t) => {
  const old = NOW - WINDOW - 1_000
  const state = baseState({ tasks: [baseTask({ updatedAt: old })] })
  const historic = await project(t, state, { now: NOW, noProgressWindowMs: WINDOW, historic: true })
  assert.equal(historic.projected.tasks[0].noProgress, undefined, 'archived snapshots are frozen history')
  const halted = await project(t, { ...state, halted: true, haltedAt: NOW }, { now: NOW, noProgressWindowMs: WINDOW })
  assert.equal(halted.projected.halted, true)
  assert.equal(halted.projected.tasks[0].noProgress, true, 'a halted running task is still observed')
  assert.equal(halted.projected.tasks[0].status, 'in_progress', 'halt never rewrites status')
  assert.equal(halted.before.tasks[0].status, 'in_progress')
})

test('投影：TeamMember.lastActivityAt 也能把锚点前移（活动后窗口重置）', async (t) => {
  const old = NOW - WINDOW - 5_000
  const state = baseState({ tasks: [baseTask({ updatedAt: old })] })
  const stalled = await project(t, state, { now: NOW, noProgressWindowMs: WINDOW })
  assert.equal(stalled.projected.tasks[0].noProgress, true)
  const active = baseState({
    tasks: [baseTask({ updatedAt: old })],
    members: [{ id: 'member', name: 'worker', status: 'working', joinedAt: NOW - 10_000, lastActivityAt: NOW - 1_000 }],
  })
  const fresh = await project(t, active, { now: NOW, noProgressWindowMs: WINDOW })
  assert.equal(fresh.projected.tasks[0].noProgress, undefined, 'a live member activity stamp resets the window')
  assert.equal(fresh.before.members[0].lastActivityAt, NOW - 1_000, 'durable stamp is read, not rewritten')
})

test('投影：不传 options 时走 Date.now 与默认窗口，窗口内不标记', async (t) => {
  const state = baseState({ tasks: [baseTask({ updatedAt: Date.now() })] })
  const { projected } = await project(t, state)
  assert.equal(projected.tasks[0].noProgress, undefined, 'the ordinary snapshot refresh path does not false-alarm')
  assert.equal('noProgress' in projected.tasks[0], false)
})
