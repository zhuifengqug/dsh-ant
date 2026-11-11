/**
 * Team activity snapshot assembly for the activity panel.
 *
 * Server-side assembly mirrors the Claude Code desktop teamWatcher: read the
 * durable team files (the truth source) and enrich with live subagent
 * activity, so the panel always reflects the on-disk state even when a model
 * skipped a tool "ritual" (e.g. not calling update_task on completion).
 * @module dsh-agent-teams/snapshot
 */
import type { Context } from '@deepseek-ai/cordis';
import type { MemberStatus, TeamState } from './types.ts';
/** Visual task state for the activity panel. */
export type VisualTaskState = 'blocked' | 'open' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';
/** One member row of the activity snapshot. */
export interface TeamActivityMember {
    readonly id: string;
    readonly name: string;
    readonly role: string;
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort: string;
    readonly executionPrompt?: string;
    readonly status: MemberStatus;
    readonly activity: 'working' | 'idle' | 'unknown';
    readonly progress: number;
    readonly done: number;
    readonly total: number;
    readonly currentTask: string;
    readonly unread: number;
}
/** One task row of the activity snapshot. */
export interface TeamActivityTask {
    readonly id: string;
    readonly subject: string;
    readonly description?: string;
    readonly status: string;
    readonly state: VisualTaskState;
    readonly assignee: string;
    readonly model: string;
    readonly dependencies: readonly string[];
    readonly depth: number;
    readonly kind?: string;
    readonly round?: number;
    readonly verdict?: string;
    /**
     * Set when this task's verdict or auto-generated work order no longer
     * describes the current bytes; the panel must not render a bare pass badge.
     */
    readonly verdictStale?: string;
    /** Durable last-write stamp; drives the finished-member ordering (issue #192). */
    readonly updatedAt: number;
    /**
     * Observation-only stall marker (R4): true when a running task has produced
     * no member output/activity for longer than the configured sliding window.
     * Never written back to durable state; it never fails, reclaims, redelivers
     * or reorders a task. Absent means "within window / not applicable".
     */
    readonly noProgress?: boolean;
    /** Milliseconds since the last member output/activity, present with the marker. */
    readonly noProgressForMs?: number;
}
/** One captain-inbox preview row. */
export interface TeamActivityMessage {
    readonly from: string;
    readonly content: string;
}
/** The full panel payload for one team. */
export interface TeamActivitySnapshot {
    readonly workspace: string;
    readonly teamId: string;
    readonly name: string;
    readonly description?: string;
    readonly captainSessionId: string;
    readonly phase: 'staged' | 'running';
    readonly planReviewState?: 'awaiting_review' | 'awaiting_feedback';
    readonly halted?: boolean;
    readonly members: readonly TeamActivityMember[];
    readonly tasks: readonly TeamActivityTask[];
    readonly messageCount: number;
    readonly captainInbox: readonly TeamActivityMessage[];
    /** Present when the snapshot could audit the workspace bytes. */
    readonly loopState?: string;
    readonly deliverable?: boolean;
    readonly delivery?: {
        readonly ok: boolean;
        readonly blockers: readonly string[];
        readonly warnings: readonly string[];
    };
}
/** Snapshot projection switches for live and archived teams. */
export interface TeamSnapshotOptions {
    /** Running panels omit the long text used only by the staging editor. */
    readonly summary?: boolean;
    /** Historic review must retain members that were marked removed at shutdown. */
    readonly includeRemoved?: boolean;
    /** Archived teams have no meaningful live activity after their sessions stop. */
    readonly historic?: boolean;
    /**
     * Absolute workspace path of the owning workspace. When present, the snapshot
     * audits the current bytes behind every recorded verdict, so the panel and
     * the model-facing status tool cannot report different delivery verdicts.
     */
    readonly workspacePath?: string;
    /**
     * Sliding no-progress window in milliseconds (R4). Overrides the per-team
     * durable value and the built-in default; only used while projecting.
     */
    readonly noProgressWindowMs?: number;
    /** Clock injection so snapshot recomputation can be tested deterministically. */
    readonly now?: number;
}
/** Compact `provider/model` route for the activity panel, or just the model. */
export declare function memberModelRoute(member: {
    provider?: string;
    model?: string;
} | undefined): string;
/** Default sliding no-progress window (R4), in milliseconds. */
export declare const DEFAULT_NO_PROGRESS_WINDOW_MS: number;
/**
 * Resolve the effective no-progress window: an explicit snapshot option wins,
 * then the per-team durable override, then the built-in default. Only finite
 * positive values are accepted, so a malformed config cannot disable detection
 * or turn every running task into a false stall.
 */
export declare function resolveNoProgressWindowMs(options: {
    readonly noProgressWindowMs?: number;
}, state: {
    readonly noProgressWindowMs?: number;
}): number;
/** A minimal timestamped member output used to anchor the sliding window. */
export interface MemberActivityStamp {
    readonly from: string;
    readonly ts: number;
}
/**
 * Last member output/activity time for one task. The anchor is the newest of
 * the durable task write, the latest captain-inbox report authored by the
 * assignee, and (when present) the member's own activity timestamp. Reports
 * from other senders never reset this task's window.
 */
export declare function lastActivityAtOf(task: {
    readonly updatedAt: number;
    readonly assignee?: string;
}, reports: readonly MemberActivityStamp[], memberLastActivityAt?: number): number;
/** Read-only result of one sliding-window check. */
export interface NoProgressObservation {
    readonly noProgress: boolean;
    readonly noProgressForMs: number;
}
/**
 * Pure, side-effect-free stall observation. A task is marked only while it is
 * still running (`claimed` or `in_progress`) and more than `windowMs` has
 * elapsed since its last member output/activity. No status, timer, reclaim,
 * redelivery or dispatch ordering is touched here.
 */
export declare function detectNoProgress(input: {
    readonly status: string;
    readonly lastActivityAt: number;
    readonly now: number;
    readonly windowMs: number;
}): NoProgressObservation;
/**
 * Assemble one team snapshot from its durable files plus live activity.
 * @param ctx - the plugin context (injects `subagents`, used for activity).
 * @param stateRoot - resolved absolute state root of the owning workspace.
 * @param workspace - display name of the owning workspace.
 * @param state - the durable team record.
 * @returns the panel snapshot.
 */
export declare function assembleTeamSnapshot(ctx: Context, stateRoot: string, workspace: string, state: TeamState, options?: TeamSnapshotOptions): Promise<TeamActivitySnapshot>;
/**
 * Collect live teams under the given workspace state roots.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs (resolved absolute roots).
 * @param captainSessionId - when present, assemble only the requested captain's teams.
 * @param summary - omit editor-only text from running teams.
 * @returns the snapshots in stable order (workspace, then team id).
 */
export declare function collectTeamsActivity(ctx: Context, roots: readonly {
    workspace: string;
    stateRoot: string;
    workspacePath?: string;
}[], captainSessionId?: string, summary?: boolean): Promise<TeamActivitySnapshot[]>;
/**
 * Collect archived teams under the given workspace state roots (the
 * `archive/` subdirectory of each state root). Used by the historic panel
 * path to restore full team detail after deletion.
 * @param ctx - the plugin context.
 * @param roots - `{ workspace, stateRoot }` pairs.
 * @param captainSessionId - when present, assemble only the requested captain's teams.
 * @returns the archived snapshots in stable order.
 */
export declare function collectArchivedTeamsActivity(ctx: Context, roots: readonly {
    workspace: string;
    stateRoot: string;
}[], captainSessionId?: string): Promise<TeamActivitySnapshot[]>;
