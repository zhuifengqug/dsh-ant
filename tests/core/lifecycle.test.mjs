import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const evidence = [{ kind: 'command', locator: 'node --test', note: 'suite green' }];
const createPayload = {
  goal: 'Retire a colony',
  workspaceRelativePath: '.',
  plan: {
    planId: 'plan-1', mode: 'normal', maxActiveAttempts: 2,
    tasks: [{ taskId: 'task-1', title: 'Only', objective: 'Only slice', inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: ['node --test'] }],
    dependencies: [],
    qualityGates: [],
  },
  members: [{ memberId: 'member-1', role: 'engineer', sessionMode: 'persistent', sessionId: 'session-1', provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] }],
};

async function fixture(t, tag, config) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-lifecycle-'));
  let service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host', config });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const created = await service.dispatch({ requestId: `create-${tag}`, action: 'team.create', payload: createPayload }, user);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: `confirm-${tag}`, teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  return { service, teamId, root };
}

// A member spawned by the colony keeps its lineage, so deletion can clean exactly that Session.
async function seedSpawnedMember(service, teamId) {
  const history = await service.wal.read(teamId);
  return service.wal.appendInternal(teamId, [
    { type: 'member.invited', payload: { sessionId: 'session-spawned', role: 'engineer', invitationId: 'invitation-1' } },
    { type: 'member.accepted', payload: { invitationId: 'invitation-1', member: { memberId: 'member-9', role: 'engineer', sessionMode: 'persistent', sessionId: 'session-spawned', origin: 'team-created', provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] } } },
  ], `internal.lineage.${history.cursor + 1}`);
}

test('archive refuses to start while an attempt is still live', async t => {
  const { service, teamId } = await fixture(t, 'busy');
  await service.dispatch({ requestId: 'dispatch-1', teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-1' } }, { actor: 'system', teamId });
  await assert.rejects(
    service.dispatch({ requestId: 'archive-busy', teamId, action: 'team.archive', payload: {} }, user),
    error => error.code === 'team/invalid-state' && /attempt/.test(error.message),
  );
  const view = await service.get({ teamId });
  assert.equal(view.lifecycle, 'running');
});

test('archive drains the team, moves the directory and stays readable from the archive', async t => {
  const { service, teamId, root } = await fixture(t, 'idle');
  const receipt = await service.dispatch({ requestId: 'archive-1', teamId, action: 'team.archive', payload: {} }, user);
  assert.equal(receipt.outcome, 'committed');
  assert.equal(receipt.archival, 'moved');

  const view = await service.get({ teamId });
  assert.equal(view.lifecycle, 'archived');

  const history = await service.wal.read(teamId);
  assert.deepEqual(history.events.map(event => event.type).slice(-3), ['team.archiving', 'team.drain-complete', 'team.archived']);

  await assert.rejects(readdir(path.join(root, 'teams', teamId)), error => error.code === 'ENOENT');
  assert.ok((await readdir(path.join(root, 'archive', teamId))).includes('events'));

  const hidden = await service.list({});
  assert.equal(hidden.teams.some(team => team.teamId === teamId), false);
  const shown = await service.list({ includeArchived: true });
  assert.equal(shown.teams.find(team => team.teamId === teamId)?.lifecycle, 'archived');
});

test('a restart keeps the archived team readable at its retired location', async t => {
  const { service, teamId, root } = await fixture(t, 'restart');
  await service.dispatch({ requestId: 'archive-1', teamId, action: 'team.archive', payload: {} }, user);
  await service.close();

  const reopened = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await reopened.close(); });
  const view = await reopened.get({ teamId });
  assert.equal(view.lifecycle, 'archived');
  assert.equal(view.teamId, teamId);
});

test('restore moves the directory back, continues the cursor and keeps the team usable', async t => {
  const { service, teamId, root } = await fixture(t, 'restore');
  await service.dispatch({ requestId: 'archive-1', teamId, action: 'team.archive', payload: {} }, user);
  await seedSpawnedMember(service, teamId);
  const archived = await service.get({ teamId });

  const receipt = await service.dispatch({ requestId: 'restore-1', teamId, action: 'team.restore', payload: {} }, user);
  assert.equal(receipt.restoration, 'moved');

  const view = await service.get({ teamId });
  assert.equal(view.lifecycle, 'planned');
  assert.ok(view.cursor > archived.cursor);
  assert.equal(view.members.length, 2);
  assert.equal(view.tasks.length, 1);

  await assert.rejects(readdir(path.join(root, 'archive', teamId)), error => error.code === 'ENOENT');
  assert.ok((await readdir(path.join(root, 'teams', teamId))).includes('events'));

  const dispatched = await service.dispatch({ requestId: 'dispatch-after-restore', teamId, action: 'attempt.dispatch', payload: { taskId: 'task-1', memberId: 'member-1' } }, { actor: 'system', teamId });
  assert.equal(dispatched.outcome, 'committed');
  assert.equal(dispatched.firstEventSeq, view.cursor + 1);
});

test('restore refuses a live team without leaving a half state', async t => {
  const { service, teamId, root } = await fixture(t, 'live');
  await assert.rejects(
    service.dispatch({ requestId: 'restore-live', teamId, action: 'team.restore', payload: {} }, user),
    error => error.code === 'team/invalid-state' && /not archived/.test(error.message),
  );
  const view = await service.get({ teamId });
  assert.equal(view.lifecycle, 'planned');
  assert.ok((await readdir(path.join(root, 'teams', teamId))).includes('events'));
});

test('delete retires colony Sessions, removes the directory and replays as a duplicate', async t => {
  const retired = [];
  const { service, teamId, root } = await fixture(t, 'delete', { retireSession: async sessionId => { retired.push(sessionId); return true; } });
  await seedSpawnedMember(service, teamId);
  await service.dispatch({ requestId: 'archive-1', teamId, action: 'team.archive', payload: {} }, user);

  const receipt = await service.dispatch({ requestId: 'delete-1', teamId, action: 'team.delete', payload: {} }, user);
  assert.equal(receipt.outcome, 'committed');
  assert.equal(receipt.deletion, 'removed');
  assert.deepEqual(retired, ['session-spawned']);

  await assert.rejects(service.get({ teamId }), error => error.code === 'team/not-found');
  await assert.rejects(readdir(path.join(root, 'teams', teamId)), error => error.code === 'ENOENT');
  await assert.rejects(readdir(path.join(root, 'archive', teamId)), error => error.code === 'ENOENT');

  const replay = await service.dispatch({ requestId: 'delete-1', teamId, action: 'team.delete', payload: {} }, user);
  assert.equal(replay.outcome, 'duplicate');
  assert.equal(replay.deletion, 'duplicate');
  const listed = await service.list({ includeArchived: true });
  assert.equal(listed.teams.some(team => team.teamId === teamId), false);
});

test('a failed retirement keeps the directory and the retry finishes it', async t => {
  let confirm = false;
  const retired = [];
  const { service, teamId, root } = await fixture(t, 'retry', { retireSession: async sessionId => { retired.push(sessionId); return confirm; } });
  await seedSpawnedMember(service, teamId);
  await service.dispatch({ requestId: 'archive-1', teamId, action: 'team.archive', payload: {} }, user);

  await assert.rejects(
    service.dispatch({ requestId: 'delete-1', teamId, action: 'team.delete', payload: {} }, user),
    error => error.code === 'team/persistence-failed' && error.details?.retryable === true,
  );
  const kept = await service.get({ teamId });
  assert.equal(kept.lifecycle, 'deleting');
  assert.ok((await readdir(path.join(root, 'archive', teamId))).includes('events'));

  confirm = true;
  const retry = await service.dispatch({ requestId: 'delete-1', teamId, action: 'team.delete', payload: {} }, user);
  assert.equal(retry.deletion, 'removed');
  await assert.rejects(service.get({ teamId }), error => error.code === 'team/not-found');
});
