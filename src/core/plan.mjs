import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { invariant } from './errors.mjs';

/** Reject escapes at the workspace owner, including existing symlink escapes. */
export async function resolveWorkspace(workspaceRoot, relativePath) {
  const root = await realpath(workspaceRoot);
  invariant(!path.isAbsolute(relativePath) && !/^[A-Za-z]:|^[/\\]{2}/.test(relativePath), 'team/invalid-action', 'Workspace path must be relative');
  const target = await realpath(path.resolve(root, relativePath));
  const relative = path.relative(root, target);
  invariant(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), 'team/forbidden', 'Workspace path escapes configured root');
  return target;
}

export function validatePlan(plan, members) {
  const tasks = new Map(), owners = new Set(), sessions = new Set();
  for (const member of members) {
    invariant(!owners.has(member.memberId), 'team/invalid-action', 'Duplicate memberId');
    owners.add(member.memberId);
    if (member.sessionId) {
      invariant(!sessions.has(member.sessionId), 'team/invalid-action', 'One session cannot have two team identities');
      sessions.add(member.sessionId);
    }
    validateScope(member);
  }
  for (const task of plan.tasks) {
    invariant(!tasks.has(task.taskId), 'team/invalid-action', 'Duplicate taskId');
    invariant(!task.ownerMemberId || owners.has(task.ownerMemberId), 'team/invalid-action', 'Task owner is not in roster');
    validateScope(task);
    tasks.set(task.taskId, task);
  }
  invariant(tasks.size > 0, 'team/invalid-action', 'Plan needs at least one task');
  const dependencies = new Map([...tasks.keys()].map(id => [id, []]));
  const edges = new Set();
  for (const edge of plan.dependencies) {
    invariant(tasks.has(edge.taskId) && tasks.has(edge.blockedByTaskId) && edge.taskId !== edge.blockedByTaskId, 'team/invalid-action', 'Invalid plan dependency');
    const key = `${edge.taskId}/${edge.blockedByTaskId}`;
    invariant(!edges.has(key), 'team/invalid-action', 'Duplicate plan dependency');
    edges.add(key);
    dependencies.get(edge.taskId).push(edge.blockedByTaskId);
  }
  const done = new Set(), visiting = new Set();
  function visit(id) {
    invariant(!visiting.has(id), 'team/invalid-action', 'Task dependency cycle');
    if (done.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id)) visit(dependency);
    visiting.delete(id); done.add(id);
  }
  for (const id of tasks.keys()) visit(id);
  const gates = new Set();
  for (const gate of plan.qualityGates) {
    invariant(tasks.has(gate.taskId) && !gates.has(gate.gateId), 'team/invalid-action', 'Invalid or duplicate quality gate');
    gates.add(gate.gateId);
  }
  return plan;
}

function validateScope(item) {
  for (const relative of [...item.inScope, ...item.outOfScope]) {
    invariant(!path.isAbsolute(relative) && !/^[A-Za-z]:|^[/\\]{2}/.test(relative) && !relative.replaceAll('\\', '/').split('/').includes('..'), 'team/invalid-action', 'Scope path escapes workspace');
  }
}

/** Dependencies are facts, not presentation order. */
/** A task releases its dependents once it is delivered: self-reported, reviewed or released. */
export const resolvedTask = task => Boolean(task) && (task.selfCompleted === true || ['completed', 'reviewed', 'released'].includes(task.state));

export function readyTasks(view) {
  return view.tasks.filter(task => task.state === 'pending' && view.plan.dependencies.filter(edge => edge.taskId === task.taskId).every(edge => resolvedTask(view.tasks.find(parent => parent.taskId === edge.blockedByTaskId))));
}
