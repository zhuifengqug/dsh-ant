import { TeamError } from './errors.mjs';

/** Hard caps keep one profile file from turning into an unbounded plan. */
export const MAX_PROFILE_TASKS = 32;
export const MAX_PROFILE_MEMBERS = 8;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }

function list(value) { return Array.isArray(value) ? value : []; }

/**
 * A named team template is data, not code: description, an optional protocol
 * excerpt for the briefs, seed tasks and seed members. Nothing here spawns.
 */
export function readProfile(name, value) {
  const id = text(name);
  if (!id) throw new TeamError('team/invalid-action', 'Profile name is required');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TeamError('team/invalid-action', `Profile "${id}" must be a JSON object`);
  }
  const tasks = list(value.plan?.tasks);
  if (tasks.length > MAX_PROFILE_TASKS) {
    throw new TeamError('team/invalid-action', `Profile "${id}" seeds ${tasks.length} tasks; the limit is ${MAX_PROFILE_TASKS}`);
  }
  const members = list(value.members);
  if (members.length > MAX_PROFILE_MEMBERS) {
    throw new TeamError('team/invalid-action', `Profile "${id}" seeds ${members.length} members; the limit is ${MAX_PROFILE_MEMBERS}`);
  }
  for (const task of tasks) {
    const taskId = text(task?.taskId);
    if (!taskId) throw new TeamError('team/invalid-action', `Profile "${id}" has a task without taskId`);
    if (!text(task.objective)) throw new TeamError('team/invalid-action', `Profile "${id}" task "${taskId}" needs an objective`);
  }
  return {
    name: id,
    description: text(value.description),
    protocol: text(value.protocol),
    plan: {
      tasks: tasks.map(task => ({ ...task })),
      dependencies: list(value.plan?.dependencies).map(edge => ({ ...edge })),
      qualityGates: list(value.plan?.qualityGates).map(gate => ({ ...gate })),
    },
    members: members.map(member => ({ ...member })),
  };
}

/** Expand a template into the exact payload team.create accepts; the caller still dispatches. */
export function expandProfile(profile, options = {}) {
  const goal = text(options.goal);
  if (!goal) throw new TeamError('team/invalid-action', `Pass a goal: /ant create ${profile.name} <goal>`);
  const leadMemberId = text(options.leadMemberId) || undefined;
  return {
    goal,
    workspaceRelativePath: text(options.workspaceRelativePath) || '.',
    plan: {
      planId: text(options.planId) || `plan-${profile.name}`,
      mode: 'normal',
      maxActiveAttempts: 1,
      tasks: profile.plan.tasks.map(task => ({ ...task })),
      dependencies: profile.plan.dependencies.map(edge => ({ ...edge })),
      qualityGates: profile.plan.qualityGates.map(gate => ({ ...gate })),
    },
    members: profile.members.map(member => ({ ...member })),
    ...(leadMemberId === undefined ? {} : { leadMemberId }),
  };
}

/** One line per profile, so a listing stays readable in a chat surface. */
export function describeProfile(profile) {
  const tasks = profile.plan.tasks.length;
  const members = profile.members.length;
  const counts = `${tasks} task${tasks === 1 ? '' : 's'} · ${members} member${members === 1 ? '' : 's'}`;
  return profile.description ? `${profile.name} — ${profile.description} (${counts})` : `${profile.name} (${counts})`;
}
