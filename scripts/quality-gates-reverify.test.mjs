#!/usr/bin/env node
/**
 * R5: a verification re-run executes only the failed or missing verify
 * commands (passed results are carried forward), and completion evidence
 * must belong to the task's current attempt.
 *
 * Loads the real src/quality-gates.ts under Node's default strip-only type
 * stripping: lib/ is a stale build on feat/xuanju and does not contain R5.
 *
 * Run: node --test scripts/quality-gates-reverify.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateQualityCompletion,
  latestCommandStatus,
  pendingVerifyCommands,
  storedEvidenceTrusted,
  evidenceAttemptStamp,
  stampEvidenceAttempt,
  crossAttemptEvidenceError,
  amendTaskContract,
  planQualityFollowUp,
} from '../src/quality-gates.ts'

const A = 'node --test scripts/a.test.mjs'
const B = 'pnpm typecheck'
const C = 'pnpm build'
const VERIFY = [A, B]
const ACCEPTANCE = ['src/a.ts says ok', 'no regression']

function implTask(extra = {}) {
  return {
    id: 't1', subject: 'impl', status: 'in_progress', dependencies: [],
    createdAt: 0, updatedAt: 0, attempt: 1, kind: 'implementation',
    objective: 'Write the sample', inScope: ['src/'], outOfScope: [],
    acceptance: [...ACCEPTANCE], verify: [...VERIFY],
    ...extra,
  }
}
function passing(task, extra = {}) {
  return {
    status: 'completed',
    changedPaths: ['src/a.ts'],
    acceptanceResults: task.acceptance.map((criterion) => ({ criterion, status: 'passed' })),
    commandsRun: task.verify.map((command) => ({ command, status: 'passed' })),
    ...extra,
  }
}
function storedPassing(task) {
  const results = passing(task)
  return { changedPaths: results.changedPaths, acceptanceResults: results.acceptanceResults, commandsRun: results.commandsRun }
}
function teamWith(tasks) {
  return { name: 't', id: 't', description: '', captainSessionId: 'captain', createdAt: 0, taskSeq: tasks.length, members: [], tasks }
}

test('验证重跑：重跑失败命令可以清掉早期失败，只有最新一次观察作数', () => {
  const task = implTask()
  const update = passing(task, { commandsRun: [
    { command: A, status: 'failed', exitCode: 2 },
    { command: B, status: 'passed' },
    { command: A, status: 'passed' },
  ] })
  const result = evaluateQualityCompletion(task, update)
  assert.equal(result.ok, true, result.error)
  assert.equal(latestCommandStatus(update.commandsRun), 'passed')
  assert.deepEqual(pendingVerifyCommands(task.verify, update.commandsRun), [])
})

test('验证重跑：最新一次仍是失败就不许完成', () => {
  const task = implTask()
  const update = passing(task, { commandsRun: [
    { command: A, status: 'passed' },
    { command: B, status: 'passed' },
    { command: A, status: 'failed', exitCode: 2 },
  ] })
  const result = evaluateQualityCompletion(task, update)
  assert.equal(result.ok, false)
  assert.match(result.error, /verify failure must fail the task/)
  assert.equal(result.requiredStatus, 'failed')
  assert.deepEqual(pendingVerifyCommands(task.verify, update.commandsRun), [A])
})

test('验证重跑：丢掉失败条目不能骗过覆盖检查，错误只点名缺失/失败命令', () => {
  const task = implTask()
  const update = passing(task, { commandsRun: [{ command: B, status: 'passed' }] })
  const result = evaluateQualityCompletion(task, update)
  assert.equal(result.ok, false)
  assert.match(result.error, /requires a passed commandsRun entry for every verify command/)
  assert.ok(result.error.includes('Re-run only these failed or missing verify commands'))
  assert.ok(result.error.includes(A), 'must name the missing command')
  assert.ok(!result.error.includes(B), 'must not ask to re-run the already-passed command')
  assert.ok(result.error.includes('carried forward and must not be re-run'))
  assert.deepEqual(pendingVerifyCommands(task.verify, update.commandsRun), [A])
})

test('完成证据：上一代记录的通过不能带当前 attempt 完成', () => {
  const base = implTask()
  const task = implTask({ ...storedPassing(base), attemptId: 'att-2', evidenceAttemptId: 'att-1' })
  const result = evaluateQualityCompletion(task, { status: 'completed' })
  assert.equal(result.ok, false)
  assert.match(result.error, /previous attempt/)
  assert.ok(result.error.includes('att-2'), 'error must expose the current attempt_id')
})

test('完成证据：本代自带证据时不受旧戳影响', () => {
  const base = implTask()
  const task = implTask({ ...storedPassing(base), attemptId: 'att-2', evidenceAttemptId: 'att-1' })
  const result = evaluateQualityCompletion(task, passing(task))
  assert.equal(result.ok, true, result.error)
})

test('完成证据：无戳的历史任务保持可读可完成', () => {
  const base = implTask()
  const task = implTask({ ...storedPassing(base) })
  const result = evaluateQualityCompletion(task, { status: 'completed' })
  assert.equal(result.ok, true, result.error)
})

test('完成证据：review 类上一代记录的 verdict 不能带当前 attempt 完成', () => {
  const base = implTask()
  const task = { ...base, kind: 'review', verdict: 'pass', findings: [], attemptId: 'att-2', evidenceAttemptId: 'att-1' }
  const blocked = evaluateQualityCompletion(task, { status: 'completed' })
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /previous attempt/)
  const fresh = evaluateQualityCompletion(task, { status: 'completed', verdict: 'pass', findings: [] })
  assert.equal(fresh.ok, true, fresh.error)
})

test('完成证据：显式跨代 attemptId 的完成证据明确拒收并给出可操作文案', () => {
  const task = implTask({ attemptId: 'att-2' })
  const result = evaluateQualityCompletion(task, passing(task, { attemptId: 'att-1' }))
  assert.equal(result.ok, false)
  assert.match(result.error, /cross-attempt evidence is rejected/)
  assert.ok(result.error.includes('attempt_id="att-2"'), 'must name the current attempt_id')
  assert.ok(result.error.includes('Re-run only the failed or missing verify commands'))
})

test('pendingVerifyCommands 只返回失败或缺失命令，通过的沿用结果', () => {
  assert.deepEqual(pendingVerifyCommands([A, B, C], [
    { command: A, status: 'passed' },
    { command: B, status: 'failed' },
  ]), [B, C])
  assert.deepEqual(pendingVerifyCommands([A, A, B], [
    { command: A, status: 'failed' },
    { command: A, status: 'passed' },
  ]), [B], 'duplicates collapse and the latest observation wins')
  assert.deepEqual(pendingVerifyCommands(undefined, undefined), [])
  assert.deepEqual(pendingVerifyCommands([A, B], undefined), [A, B])
})

test('latestCommandStatus 以每个命令的最后一次观察为准', () => {
  assert.equal(latestCommandStatus(undefined), undefined)
  assert.equal(latestCommandStatus([]), undefined)
  assert.equal(latestCommandStatus([{ command: A, status: 'passed' }]), 'passed')
  assert.equal(latestCommandStatus([{ command: A, status: 'failed' }, { command: A, status: 'passed' }]), 'passed')
  assert.equal(latestCommandStatus([{ command: A, status: 'passed' }, { command: A, status: 'failed' }]), 'failed')
  assert.equal(latestCommandStatus([{ command: A, status: 'passed' }, { command: B, status: 'failed' }]), 'failed')
})

test('evidence stamp 往返：本代 trusted、换 attempt 后失配且被 gate 拒收', () => {
  const task = implTask({ attemptId: 'att-1' })
  assert.equal(evidenceAttemptStamp(task), undefined)
  assert.equal(storedEvidenceTrusted(task), true)
  stampEvidenceAttempt(task)
  assert.equal(evidenceAttemptStamp(task), 'att-1')
  assert.equal(storedEvidenceTrusted(task), true)
  task.attemptId = 'att-2'
  assert.equal(storedEvidenceTrusted(task), false)
  const blocked = evaluateQualityCompletion({ ...task, ...storedPassing(task) }, { status: 'completed' })
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /previous attempt/)
  const noAttempt = implTask()
  noAttempt.evidenceAttemptId = 'old'
  stampEvidenceAttempt(noAttempt)
  assert.equal(evidenceAttemptStamp(noAttempt), undefined, 'no attemptId clears the stamp')
})

test('crossAttemptEvidenceError：无证据/匹配/无 attemptId 不拦，缺参或跨代给可操作错误', () => {
  const task = implTask({ attemptId: 'att-2' })
  assert.equal(crossAttemptEvidenceError(task, 'att-2', true), undefined)
  assert.equal(crossAttemptEvidenceError(task, undefined, false), undefined)
  assert.equal(crossAttemptEvidenceError(implTask(), 'att-1', true), undefined)
  const missing = crossAttemptEvidenceError(task, undefined, true)
  assert.match(missing, /no attempt_id/)
  assert.match(missing, /Cross-attempt evidence is rejected/)
  assert.ok(missing.includes('att-2'))
  assert.ok(missing.includes('Re-run only the failed or missing verify commands'))
  const stale = crossAttemptEvidenceError(task, 'att-1', true)
  assert.match(stale, /Cross-attempt evidence is rejected/)
  assert.ok(stale.includes('att-2'))
})

test('work 类任务不受门禁与 attempt 绑定影响', () => {
  const task = implTask({ kind: 'work', attemptId: 'att-2' })
  assert.equal(evaluateQualityCompletion(task, { status: 'completed', attemptId: 'att-1' }).ok, true)
})

test('回归：contract is frozen 语义未改动（src/quality-gates.ts:738/:803）', () => {
  const impl = implTask()
  const review = { ...implTask(), id: 'r1', kind: 'review', verdict: 'pass', reviewedTaskId: 't1' }
  const team = teamWith([impl, review])
  const result = amendTaskContract(team, impl, { verify: ['node -e "process.exit(1)"'] }, 'captain', 'late idea')
  assert.equal(result.ok, false)
  assert.match(result.error, /frozen/)
})

test('回归：amend 既有 completedResults fixture 仍可完成', () => {
  const task = implTask()
  const result = evaluateQualityCompletion(task, passing(task))
  assert.equal(result.ok, true, result.error)
})

test('回归：planQualityFollowUp 的 verify 契约仍为全量（未改动）', () => {
  const implementation = {
    id: 't1', subject: 'impl', status: 'completed', dependencies: [], createdAt: 0, updatedAt: 0,
    attempt: 1, kind: 'implementation', assignee: 'implementer', inScope: ['src/'],
    acceptance: ['done'], verify: ['node --test'], changedPaths: ['src/app.js'],
    acceptanceResults: [{ criterion: 'done', status: 'passed' }],
    commandsRun: [{ command: 'node --test', status: 'passed', exitCode: 0 }],
  }
  const failed = {
    id: 't3', subject: 'verification', status: 'failed', dependencies: ['t1'], createdAt: 0, updatedAt: 0,
    attempt: 1, kind: 'verification', assignee: 'verifier',
    acceptance: ['Declared verification commands pass'], verify: ['node --test'],
    acceptanceResults: [{ criterion: 'Declared verification commands pass', status: 'failed', evidence: 'EXIT=2' }],
    commandsRun: [{ command: 'node --test', status: 'failed', exitCode: 2, evidence: 'half-written symbols' }],
    output: 'two gates failed',
  }
  const team = {
    name: 't', id: 't', description: '', captainSessionId: 'captain', createdAt: 0, taskSeq: 2,
    members: [
      { id: 'member-implementer', name: 'implementer', role: 'implementer', joinedAt: 0, status: 'idle' },
      { id: 'member-reviewer', name: 'reviewer', role: 'reviewer', joinedAt: 0, status: 'idle' },
      { id: 'member-verifier', name: 'verifier', role: 'verifier', joinedAt: 0, status: 'idle' },
    ],
    tasks: [implementation, failed],
  }
  const planned = planQualityFollowUp(team, failed)
  const repair = planned.created.find((item) => item.kind === 'repair')
  const recheck = planned.created.find((item) => item.kind === 'verification')
  assert.ok(repair, 'no repair generated')
  assert.deepEqual(repair.verify, ['node --test'])
  assert.deepEqual(recheck.verify, ['node --test'])
})
