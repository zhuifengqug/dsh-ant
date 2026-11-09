import { randomUUID } from 'node:crypto';
import { TeamError } from '../core/errors.mjs';
import { serializeError } from './context.mjs';

const USAGE = [
  'Usage:',
  '  /ant                      this help',
  '  /ant status [teamId]      where the colony is now',
  '  /ant plan [teamId]        the confirmed plan and every task state',
  '  /ant release [teamId]     release everything waiting in the gate hall',
  '  /ant audit [teamId]       re-hash every recorded deliverable',
  '  /ant <JSON request>       dispatch any Team action verbatim',
].join('\n');

const RETIRED = new Set(['archived', 'archiving', 'deleting']);

function parseInput(rawInput) {
  const text = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (!text) throw new TeamError('team/invalid-action', USAGE);
  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new TeamError('team/invalid-action', `Invalid /ant request: ${cause.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TeamError('team/invalid-action', 'The /ant request must be a JSON object');
  }
  return value;
}

/** One live Team is the default target; several must be named, because guessing would act on the wrong colony. */
async function resolveTeamId(service, wanted, signal) {
  if (wanted) return wanted;
  const listed = await service.list({}, signal);
  const live = (listed.teams ?? []).filter(team => !RETIRED.has(team.lifecycle));
  if (live.length === 1) return live[0].teamId;
  if (live.length === 0) throw new TeamError('team/not-found', 'No live Team in this workspace; pass a teamId');
  throw new TeamError('team/invalid-action', `Several live Teams, name one: ${live.map(team => team.teamId).join(', ')}`);
}

function plural(count, word) { return count + ' ' + word + (count === 1 ? '' : 's'); }

function formatStatus(view) {
  const summary = view.summary ?? {};
  const counts = summary.counts ?? {};
  const lines = [
    `${view.goal ?? view.teamId} · ${view.lifecycle ?? 'unknown'}${summary.halted ? ' · halted' : ''}`,
    `plan ${summary.planState ?? 'unknown'} · cursor ${view.cursor ?? '—'}`,
    `tasks ${counts.total ?? 0}: ${counts.running ?? 0} running · ${counts.reviewed ?? 0} reviewed · ${counts.released ?? 0} released · ${counts.failed ?? 0} failed`,
    `open attempts ${(summary.open ?? []).length} · unread ${summary.unread?.total ?? 0}${summary.unread?.toLead ? ` (${summary.unread.toLead} to the lead)` : ''}`,
  ];
  if ((summary.repairs ?? []).length) lines.push('waiting for a human: ' + summary.repairs.join(', '));
  if (summary.lastBatch) lines.push(`last batch ${summary.lastBatch.batchId} · ${plural(summary.lastBatch.taskIds.length, 'task')} @${summary.lastBatch.eventSeq}`);
  return lines.join('\n');
}

function formatPlan(view) {
  const plan = view.plan ?? {};
  const tasks = plan.tasks ?? [];
  const coverage = new Map((view.coverage?.tasks ?? []).map(task => [task.taskId, task]));
  const lines = [`plan ${view.summary?.planState ?? 'unknown'} · ${plural(tasks.length, 'task')}`];
  for (const task of tasks) {
    const state = coverage.get(task.taskId)?.state ?? 'pending';
    const gates = coverage.get(task.taskId)?.pendingGates ?? [];
    const marks = (coverage.get(task.taskId)?.selfCompleted ? ' ✓' : '') + (gates.length ? ` · gates: ${gates.join(', ')}` : '');
    lines.push(`· ${task.taskId} ${state} ${task.title ?? ''}${marks}`);
  }
  return lines.join('\n');
}

async function releasePending(service, teamId, signal) {
  const view = await service.get({ teamId }, signal);
  const pending = (view.releaseQueue ?? []).map(task => task.taskId);
  if (pending.length === 0) return 'Nothing is waiting for release.';
  const receipt = await service.dispatchAsOwner({
    requestId: `command-${randomUUID()}`,
    teamId,
    action: 'batch.release',
    payload: { batchId: `batch-${(view.cursor ?? 0) + 1}`, taskIds: pending },
  }, signal);
  return `released ${plural(pending.length, 'task')}: ${pending.join(', ')} · seq ${receipt.lastEventSeq}`;
}

function formatAudit(report) {
  const findings = report.findings ?? [];
  if (report.ok) return `Every recorded file still matches its digest (${plural(findings.length, 'claim')}).`;
  const open = findings.filter(item => item.status !== 'match' && item.status !== 'outside' && item.status !== 'unstamped');
  const lines = [`${plural(open.length, 'claim')} no longer match · ${plural(findings.length - open.length, 'claim')} unchanged`];
  for (const item of open) lines.push(`· ${item.locator} ${item.status} (${item.taskId})`);
  return lines.join('\n');
}

async function auditDeliverables(service, teamId) {
  if (typeof service.auditArtifacts !== 'function') throw new TeamError('team/unavailable', 'This Host cannot audit deliverables');
  return formatAudit(await service.auditArtifacts({ teamId }));
}

function formatResult(receipt) {
  return JSON.stringify(receipt);
}

export function createAntCommand(service) {
  return {
    definitionId: '@zhuifengqug/dsh-ant/command-ant',
    name: 'ant',
    description: 'Inspect the colony, release its gate hall, or dispatch one Team action as JSON.',
    input: { hint: '[status|plan|release] or <JSON team action request>', attachments: false },
    handler: async invocation => {
      const rawInput = typeof invocation.rawInput === 'string' ? invocation.rawInput.trim() : '';
      try {
        if (rawInput.startsWith('{')) {
          const receipt = await service.dispatchAsOwner(parseInput(rawInput), invocation.signal);
          return { kind: 'success', text: formatResult(receipt), sourceEventSeq: receipt.lastEventSeq };
        }
        const [verb, ...rest] = rawInput.split(/\s+/).filter(Boolean);
        if (!verb) return { kind: 'success', text: USAGE };
        if (!['status', 'plan', 'release', 'audit'].includes(verb)) throw new TeamError('team/invalid-action', USAGE);
        const teamId = await resolveTeamId(service, rest[0], invocation.signal);
        if (verb === 'release') {
          const text = await releasePending(service, teamId, invocation.signal);
          return { kind: 'success', text };
        }
        if (verb === 'audit') return { kind: 'success', text: await auditDeliverables(service, teamId) };
        const view = await service.get({ teamId }, invocation.signal);
        return { kind: 'success', text: verb === 'status' ? formatStatus(view) : formatPlan(view), sourceEventSeq: view.cursor };
      } catch (error) {
        return { kind: 'error', text: JSON.stringify(serializeError(error)) };
      }
    },
  };
}
