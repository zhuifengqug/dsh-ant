/**
 * Team activity snapshot assembly for the activity panel.
 *
 * Server-side assembly mirrors the Claude Code desktop teamWatcher: read the
 * durable team files (the truth source) and enrich with live subagent
 * activity, so the panel always reflects the on-disk state even when a model
 * skipped a tool "ritual" (e.g. not calling update_task on completion).
 * @module dsh-agent-teams/snapshot
 */

import type { Context } from '@deepseek-ai/cordis'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { memberActivity } from './members.ts'
import { canDeclareDelivery, describeQualityLoop, verdictAuditNotes } from './quality-gates.ts'
import { workspaceAuditor } from './workspace-audit-service.ts'
import {
  CAPTAIN_KEY, listArchivedTeamIds, readArchivedTeam, readMailbox, readUnreadMailbox, readTeam,
  taskDepthsById, taskVisualState,
} from './state.ts'
import type { MemberStatus, TeamState, TeamTask } from './types.ts'

/** Visual task state for the activity panel. */
export type VisualTaskState = 'blocked' | 'open' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled'

/** One member row of the activity snapshot. */
export interface TeamActivityMember {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly executionPrompt?: string
  readonly status: MemberStatus
  readonly activity: 'working' | 'idle' | 'unknown'
  readonly progress: number
  readonly done: number
  readonly total: number
  readonly currentTask: string
  readonly unread: number
}

/** One task row of the activity snapshot. */
export interface TeamActivityTask {
  readonly id: string
  readonly subject: string
  readonly description?: string
  readonly status: string
  readonly state: VisualTaskState
  readonly assignee: string
  readonly model: string
  readonly dependencies: readonly string[]
  readonly depth: number
  readonly kind?: string
  readonly round?: number
  readonly verdict?: string
  /**
   * Set when this task's verdict or auto-generated work order no longer
   * describes the current bytes; the panel must not render a bare pass badge.
   */
  readonly verdictStale?: string
  /** Durable last-write stamp; drives the finished-member ordering (issue #192). */
  readonly updatedAt: number
  /**
   * Observation-only stall marker (R4): true when a running task has produced
   * no member output/activity for longer than the configured sliding window.
   * Never written back to durable state; it never fails, reclaims, redelivers
   * or reorders a task. Absent means "within window / not applicable".
   */
  readonly noProgress?: boolean
  /** Milliseconds since the last member output/activity, present with the marker. */
  readonly noProgressForMs?: number
}

/** One captain-inbox preview row. */
export interface TeamActivityMessage {
  readonly from: string
  readonly content: string
}

/** The full panel payload for one team. */
export interface TeamActivitySnapshot {
  readonly workspace: string
  readonly teamId: string
  readonly name: string
  readonly description?: string
  readonly captainSessionId: string
  readonly phase: 'staged' | 'running'
  readonly planReviewState?: 'awaiting_review' | 'awaiting_feedback'
  readonly halted?: boolean
  readonly members: readonly TeamActivityMember[]
  readonly tasks: readonly TeamActivityTask[]
  readonly messageCount: number
  readonly captainInbox: readonly TeamActivityMessage[]
  /** Present when the snapshot could audit the workspace bytes. */
  readonly loopState?: string
  readonly deliverable?: boolean
  readonly delivery?: { readonly ok: boolean; readonly blockers: readonly string[]; readonly warnings: readonly string[] }
}

/** Snapshot projection switches for live and archived teams. */
export interface TeamSnapshotOptions {
  /** Running panels omit the long text used only by the staging editor. */
  readonly summary?: boolean
  /** Historic review must retain members that were marked removed at shutdown. */
  readonly includeRemoved?: boolean
  /** Archived teams have no meaningful live activity after their sessions stop. */
  readonly historic?: boolean
  /**
   * Absolute workspace path of the owning workspace. When present, the snapshot
   * audits the current bytes behind every recorded verdict, so the panel and
   * the model-facing status tool cannot report different delivery verdicts.
   */
  readonly workspacePath?: string
  /**
   * Sliding no-progress window in milliseconds (R4). Overrides the per-team
   * durable value and the built-in default; only used while projecting.
   */
  readonly noProgressWindowMs?: number
  /** Clock injection so snapshot recomputation can be tested deterministically. */
  readonly now?: number
}

/** The current task of a member: its first unfinished owned task. */
function currentTaskOf(memberName: string, tasks: readonly TeamTask[]): string {
  for (const task of tasks) {
    if (task.status === 'in_progress' && task.assignee === memberName) return task.id
  }
  return ''
}

/** Compact `provider/model` route for the activity panel, or just the model. */
export function memberModelRoute(member: { provider?: string; model?: string } | undefined): string {
  if (member === undefined) return ''
  const provider = member.provider?.trim() ?? ''
  const model = member.model?.trim() ?? ''
  if (provider !== '' && model !== '') return `${provider}/${model}`
  return model
}

/** Default sliding no-progress window (R4), in milliseconds. */
export const DEFAULT_NO_PROGRESS_WINDOW_MS = 5 * 60 * 1000

/**
 * Resolve the effective no-progress window: an explicit snapshot option wins,
 * then the per-team durable override, then the built-in default. Only finite
 * positive values are accepted, so a malformed config cannot disable detection
 * or turn every running task into a false stall.
 */
export function resolveNoProgressWindowMs(
  options: { readonly noProgressWindowMs?: number },
  state: { readonly noProgressWindowMs?: number },
): number {
  for (const candidate of [options.noProgressWindowMs, state.noProgressWindowMs]) {
    if (candidate !== undefined && Number.isFinite(candidate) && candidate > 0) return candidate
  }
  return DEFAULT_NO_PROGRESS_WINDOW_MS
}

/** A minimal timestamped member output used to anchor the sliding window. */
export interface MemberActivityStamp {
  readonly from: string
  readonly ts: number
}

/**
 * Last member output/activity time for one task. The anchor is the newest of
 * the durable task write, the latest captain-inbox report authored by the
 * assignee, and (when present) the member's own activity timestamp. Reports
 * from other senders never reset this task's window.
 */
export function lastActivityAtOf(
  task: { readonly updatedAt: number; readonly assignee?: string },
  reports: readonly MemberActivityStamp[],
  memberLastActivityAt?: number,
): number {
  let latest = Number.isFinite(task.updatedAt) ? task.updatedAt : 0
  if (memberLastActivityAt !== undefined && Number.isFinite(memberLastActivityAt) && memberLastActivityAt > latest) {
    latest = memberLastActivityAt
  }
  const assignee = task.assignee
  if (assignee !== undefined && assignee !== '') {
    for (const report of reports) {
      if (report.from === assignee && Number.isFinite(report.ts) && report.ts > latest) latest = report.ts
    }
  }
  return latest
}

/** Read-only result of one sliding-window check. */
export interface NoProgressObservation {
  readonly noProgress: boolean
  readonly noProgressForMs: number
}

/**
 * Pure, side-effect-free stall observation. A task is marked only while it is
 * still running (`claimed` or `in_progress`) and more than `windowMs` has
 * elapsed since its last member output/activity. No status, timer, reclaim,
 * redelivery or dispatch ordering is touched here.
 */
export function detectNoProgress(input: {
  readonly status: string
  readonly lastActivityAt: number
  readonly now: number
  readonly windowMs: number
}): NoProgressObservation {
  const { status, lastActivityAt, now, windowMs } = input
  const running = status === 'claimed' || status === 'in_progress'
  const elapsed = now - lastActivityAt
  const noProgressForMs = elapsed > 0 ? elapsed : 0
  const noProgress = running
    && Number.isFinite(now)
    && Number.isFinite(lastActivityAt)
    && Number.isFinite(windowMs)
    && windowMs > 0
    && lastActivityAt > 0
    && elapsed > windowMs
  return { noProgress, noProgressForMs }
}

/**
 * Assemble one team snapshot from its durable files plus live activity.
 * @param ctx - the plugin context (injects `subagents`, used for activity).
 * @param stateRoot - resolved absolute state root of the owning workspace.
 * @param workspace - display name of the owning workspace.
 * @param state - the durable team record.
 * @returns the panel snapshot.
 */
export async function assembleTeamSnapshot(
  ctx: Context,
  stateRoot: string,
  workspace: string,
  state: TeamState,
  options: TeamSnapshotOptions = {},
): Promise<TeamActivitySnapshot> {
  const tasks = state.tasks
  const includePlanText = options.summary !== true || state.phase === 'staged' || options.historic === true
  const depths = taskDepthsById(tasks)
  const roster = options.includeRemoved === true
    ? state.members
    : state.members.filter((member) => member.status !== 'removed')
  const activity = options.historic === true
    ? new Map<string, 'running' | 'idle' | 'ready'>()
    : memberActivity(ctx, roster.map((member) => member.id))
  const unreadByMember = new Map<string, number>()
  for (const member of roster) {
    try {
      unreadByMember.set(member.name, (await readUnreadMailbox(stateRoot, state.id, member.name)).length)
    } catch (error: unknown) {
      ctx.logger.warn(`agent-teams: mailbox read failed for ${member.name}: ${String(error)}`)
      unreadByMember.set(member.name, 0)
    }
  }
  const members: TeamActivityMember[] = roster.map((member) => {
    const owned = tasks.filter((task) => task.assignee === member.name)
    const done = owned.filter((task) => task.status === 'completed').length
    return {
      id: member.id,
      name: member.name,
      role: member.role ?? '',
      provider: member.provider?.trim() ?? '',
      model: member.model?.trim() ?? '',
      reasoningEffort: member.reasoningEffort?.trim() ?? '',
      ...includePlanText ? { executionPrompt: member.executionPrompt ?? '' } : {},
      status: member.status,
      activity: options.historic === true
        ? 'idle'
        : member.id !== ''
          ? (activity.get(member.id) === 'running'
              ? 'working'
              : activity.get(member.id) === 'idle' || activity.get(member.id) === 'ready'
                ? 'idle'
                : 'unknown')
          : 'idle',
      progress: owned.length === 0 ? 0 : Math.round((done / owned.length) * 100),
      done,
      total: owned.length,
      currentTask: currentTaskOf(member.name, tasks),
      unread: unreadByMember.get(member.name) ?? 0,
    }
  })
  const captainInbox = await readUnreadMailbox(stateRoot, state.id, CAPTAIN_KEY)
  // The panel must reach the same delivery conclusion as the status tool, so
  // it reads the same current bytes instead of trusting task records alone.
  const audit = options.workspacePath === undefined ? undefined : await workspaceAuditor(ctx).audit(options.workspacePath, state, stateRoot)
  const deliveryCheck = audit === undefined ? canDeclareDelivery(state) : canDeclareDelivery(state, audit)
  const loop = audit === undefined ? describeQualityLoop(state) : describeQualityLoop(state, audit)
  const staleById = new Map<string, string[]>()
  if (audit !== undefined) {
    for (const note of verdictAuditNotes(state, audit)) {
      staleById.set(note.taskId, [...staleById.get(note.taskId) ?? [], note.message])
    }
  }
  // R4: recompute the sliding no-progress window inside the existing snapshot
  // refresh path. Read-only: durable timestamps and the captain mailbox are
  // the only inputs, nothing is written back, and no timer is installed.
  const observeNoProgress = options.historic !== true
  const now = options.now ?? Date.now()
  const noProgressWindowMs = resolveNoProgressWindowMs(options, state)
  const latestReportBySender = new Map<string, number>()
  if (observeNoProgress) {
    let captainReports: readonly MemberActivityStamp[] = []
    try {
      captainReports = await readMailbox(stateRoot, state.id, CAPTAIN_KEY)
    } catch (error: unknown) {
      ctx.logger.warn(`agent-teams: captain mailbox read failed for no-progress detection: ${String(error)}`)
      captainReports = []
    }
    for (const report of captainReports) {
      if (!Number.isFinite(report.ts)) continue
      const previous = latestReportBySender.get(report.from)
      if (previous === undefined || report.ts > previous) latestReportBySender.set(report.from, report.ts)
    }
  }
  const senderActivity: MemberActivityStamp[] = [...latestReportBySender].map(([from, ts]) => ({ from, ts }))
  return {
    workspace,
    teamId: state.id,
    name: state.name,
    ...state.description !== undefined ? { description: state.description } : {},
    captainSessionId: state.captainSessionId,
    phase: state.phase ?? 'running',
    ...state.phase === 'staged'
      ? { planReviewState: state.planReviewState ?? 'awaiting_review' as const }
      : {},
    ...state.halted === true ? { halted: true } : {},
    ...audit === undefined ? {} : {
      loopState: loop.state,
      deliverable: loop.deliverable,
      delivery: { ok: deliveryCheck.ok, blockers: [...deliveryCheck.blockers], warnings: [...deliveryCheck.warnings] },
    },
    members,
    tasks: tasks.map((task) => {
      const observation = observeNoProgress
        ? detectNoProgress({
          status: task.status,
          lastActivityAt: lastActivityAtOf(
            task,
            senderActivity,
            roster.find((member) => member.name === task.assignee)?.lastActivityAt,
          ),
          now,
          windowMs: noProgressWindowMs,
        })
        : undefined
      return {
        id: task.id,
        subject: task.subject,
        ...includePlanText ? { description: task.description ?? '' } : {},
        status: task.status,
        state: taskVisualState(task.status, task.dependencies, tasks),
        assignee: task.assignee ?? '',
        model: memberModelRoute(roster.find((member) => member.name === task.assignee)),
        dependencies: task.dependencies,
        depth: depths.get(task.id) ?? 0,
        ...task.kind === undefined ? {} : { kind: task.kind },
        ...task.round === undefined ? {} : { round: task.round },
        ...task.verdict === undefined ? {} : { verdict: task.verdict },
        ...staleById.get(task.id) === undefined ? {} : { verdictStale: (staleById.get(task.id) as string[]).join('; ') },
        updatedAt: task.updatedAt,
        ...observation?.noProgress === true ? { noProgress: true, noProgressForMs: observation.noProgressForMs } : {},
      }
    }),
    messageCount: captainInbox.length
      + members.reduce((count, member) => count + member.unread, 0),
    captainInbox: captainInbox.slice(-5).map((message) => ({
      from: message.from,
      content: message.content,
    })),
  }
}

/**
 * Collect live teams under the given workspace state roots.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs (resolved absolute roots).
 * @param captainSessionId - when present, assemble only the requested captain's teams.
 * @param summary - omit editor-only text from running teams.
 * @returns the snapshots in stable order (workspace, then team id).
 */
export async function collectTeamsActivity(
  ctx: Context,
  roots: readonly { workspace: string; stateRoot: string; workspacePath?: string }[],
  captainSessionId?: string,
  summary = false,
): Promise<TeamActivitySnapshot[]> {
  const snapshots: TeamActivitySnapshot[] = []
  for (const root of roots) {
    let entries
    try {
      entries = await readdir(root.stateRoot, { withFileTypes: true })
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const state = await readTeam(root.stateRoot, entry.name)
        if (state === undefined || (captainSessionId !== undefined && state.captainSessionId !== captainSessionId)) continue
        snapshots.push(await assembleTeamSnapshot(ctx, root.stateRoot, root.workspace, state, {
          summary,
          ...root.workspacePath === undefined ? {} : { workspacePath: root.workspacePath },
        }))
      } catch {
        ctx.logger.warn(`agent-teams: skipped unreadable team state "${entry.name}" in workspace "${root.workspace}"`)
      }
    }
  }
  return snapshots
}

/**
 * Collect archived teams under the given workspace state roots (the
 * `archive/` subdirectory of each state root). Used by the historic panel
 * path to restore full team detail after deletion.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs.
 * @param captainSessionId - when present, assemble only the requested captain's teams.
 * @returns the archived snapshots in stable order.
 */
export async function collectArchivedTeamsActivity(
  ctx: Context,
  roots: readonly { workspace: string; stateRoot: string }[],
  captainSessionId?: string,
): Promise<TeamActivitySnapshot[]> {
  const snapshots: TeamActivitySnapshot[] = []
  for (const root of roots) {
    for (const teamId of await listArchivedTeamIds(root.stateRoot)) {
      try {
        const state = await readArchivedTeam(root.stateRoot, teamId)
        if (state === undefined || (captainSessionId !== undefined && state.captainSessionId !== captainSessionId)) continue
        snapshots.push(await assembleTeamSnapshot(
          ctx,
          join(root.stateRoot, 'archive'),
          root.workspace,
          state,
          { includeRemoved: true, historic: true },
        ))
      } catch {
        ctx.logger.warn(`agent-teams: skipped unreadable archived team "${teamId}" in workspace "${root.workspace}"`)
      }
    }
  }
  return snapshots
}
