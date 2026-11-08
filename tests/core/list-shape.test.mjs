import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createTeamActionService } from '../../src/core/actions.mjs';

const user = { actor: 'user', principal: { kind: 'owner' } };
const member = id => ({ memberId: id, role: 'engineer', sessionMode: 'persistent', sessionId: 'session-' + id, provider: 'deepseek', model: 'deepseek-v4', inScope: ['src'], outOfScope: [] });
const plan = {
  planId: 'list-1',
  mode: 'normal',
  maxActiveAttempts: 4,
  tasks: [{ taskId: 'core', title: '实现', objective: '按规格实现', inScope: ['src'], outOfScope: [], acceptance: ['works'], verify: [] }],
  dependencies: [],
  qualityGates: [],
};

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-list-'));
  const service = await createTeamActionService({ workspaceRoot: root, ownerId: 'test-host' });
  t.after(async () => { await service.close(); await rm(root, { recursive: true, force: true }); });
  return service;
}

const create = (service, goal) => service.dispatch({ requestId: 'create-' + goal, action: 'team.create', payload: { goal, workspaceRelativePath: '.', plan: { ...plan, planId: 'list-' + goal }, members: [member('member-1')] } }, user);

test('an empty list carries no undefined cursor', async t => {
  const service = await fixture(t);
  const listed = await service.list({});
  assert.deepEqual(listed.teams, []);
  assert.equal('cursor' in listed, false);
  assert.deepEqual(JSON.parse(JSON.stringify(listed)), listed);
});

test('a full page stays lossless and a truncated page names its cursor', async t => {
  const service = await fixture(t);
  await create(service, 'alpha');
  await create(service, 'beta');
  await create(service, 'gamma');
  const all = await service.list({});
  assert.equal(all.teams.length, 3);
  assert.equal('cursor' in all, false);
  assert.deepEqual(JSON.parse(JSON.stringify(all)), all);

  const first = await service.list({ limit: 2 });
  assert.equal(first.teams.length, 2);
  assert.equal(first.cursor, '2');
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);

  const second = await service.list({ limit: 2, cursor: first.cursor });
  assert.equal(second.teams.length, 1);
  assert.equal('cursor' in second, false);
  assert.deepEqual(JSON.parse(JSON.stringify(second)), second);
});
