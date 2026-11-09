import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { AntService } from '../../src/host/service.mjs';

const panelProfile = {
  description: 'Ship a panel',
  protocol: 'Ask before touching the API',
  plan: {
    tasks: [{ taskId: 'panel', title: 'Build the panel', objective: 'Ship the panel', inScope: ['.'], outOfScope: [], acceptance: ['it renders'], verify: ['node --test'] }],
    dependencies: [],
    qualityGates: [{ gateId: 'panel-review', taskId: 'panel', kind: 'review', acceptance: ['the panel renders'] }],
  },
  members: [{ memberId: 'worker-1', role: 'engineer', sessionMode: 'persistent', sessionId: 'session-1', provider: 'fixture', model: 'fixture-model', inScope: ['.'], outOfScope: [] }],
};

async function serviceOn(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-profiles-'));
  await mkdir(path.join(root, '.ant', 'profiles'), { recursive: true });
  const context = new Context();
  context.provide('sessionController', { async prompt() { return { accepted: true }; } });
  const service = new AntService(context, { workspaceRoot: root, ownerId: 'profile-owner' });
  t.after(async () => {
    await service.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  });
  return { root, service, write: (name, body) => writeFile(path.join(root, '.ant', 'profiles', name), body, 'utf8') };
}

test('a profile on disk becomes a team the host can create', async t => {
  const { root, service, write } = await serviceOn(t);
  await write('panel.json', JSON.stringify(panelProfile));

  const listed = await service.profiles();
  assert.equal(listed.dir, path.join(root, '.ant', 'profiles'));
  assert.deepEqual(listed.profiles.map(profile => profile.name), ['panel']);

  const receipt = await service.createFromProfile({ name: 'panel', goal: 'Ship the colony panel', requestId: 'profile-create' });
  assert.equal(receipt.outcome, 'committed');
  const view = await service.get({ teamId: receipt.teamId });
  assert.equal(view.goal, 'Ship the colony panel');
  assert.equal(view.plan.planId, 'plan-panel');
  assert.deepEqual(view.plan.tasks.map(task => task.taskId), ['panel']);
  assert.deepEqual(view.members.map(member => member.memberId), ['worker-1']);
});

test('an empty profile directory is a listing, not a crash', async t => {
  const { root, service } = await serviceOn(t);
  assert.deepEqual(await service.profiles(), { dir: path.join(root, '.ant', 'profiles'), profiles: [] });
});

test('an unknown profile is named in the error', async t => {
  const { service } = await serviceOn(t);
  await assert.rejects(() => service.createFromProfile({ name: 'ghost', goal: 'x', requestId: 'p1' }), error => error.code === 'team/not-found' && /Unknown profile: ghost/.test(error.message));
});

test('a template that is not JSON names its file instead of failing the listing', async t => {
  const { service, write } = await serviceOn(t);
  await write('broken.json', '{ not json');
  await assert.rejects(() => service.profiles(), /broken\.json is not readable JSON/);
});
