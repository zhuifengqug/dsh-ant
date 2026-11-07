import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
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

async function fixture(t, tag) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-lifecycle-'));
  let service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  const created = await service.dispatch({ requestId: `create-${tag}`, action: 'team.create', payload: createPayload }, user);
  const teamId = created.teamId;
  const view = await service.get({ teamId });
  await service.dispatch({ requestId: `confirm-${tag}`, teamId, action: 'plan.confirm', payload: { planDigest: view.planDigest }, expectedEventSeq: view.cursor }, user);
  return { service, teamId, root };
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
  const sequence = history.events.map(event => event.type).slice(-3);
  assert.deepEqual(sequence, ['team.archiving', 'team.drain-complete', 'team.archived']);

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
