import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PROFILE_TASKS, describeProfile, expandProfile, readProfile } from '../../src/core/profiles.mjs';

const template = {
  description: 'Ship a panel',
  protocol: 'Ask before touching the API',
  plan: {
    tasks: [{ taskId: 'panel', title: 'Build the panel', objective: 'Ship it', acceptance: ['it renders'], verify: ['node --test'] }],
    dependencies: [],
    qualityGates: [{ gateId: 'panel-review', taskId: 'panel', kind: 'review' }],
  },
  members: [{ memberId: 'worker-1', role: 'engineer', sessionMode: 'persistent', sessionId: 'session-1', provider: 'fixture', model: 'fixture-model' }],
};

test('a profile keeps its seed, and copies what it hands out', () => {
  const profile = readProfile('panel', template);
  assert.equal(profile.name, 'panel');
  assert.equal(profile.description, 'Ship a panel');
  assert.equal(profile.protocol, 'Ask before touching the API');
  assert.equal(profile.plan.tasks[0].taskId, 'panel');
  const expanded = expandProfile(profile, { goal: 'Ship the colony panel' });
  assert.equal(expanded.goal, 'Ship the colony panel');
  assert.equal(expanded.workspaceRelativePath, '.');
  assert.equal(expanded.plan.planId, 'plan-panel');
  assert.equal(expanded.plan.mode, 'normal');
  assert.deepEqual(expanded.plan.tasks, profile.plan.tasks);
  assert.notEqual(expanded.plan.tasks, profile.plan.tasks, 'the payload is a copy, not the template itself');
  assert.equal(expanded.leadMemberId, undefined, 'no lead is invented');
});

test('a profile without a goal is refused instead of creating an unnamed team', () => {
  const profile = readProfile('panel', template);
  assert.throws(() => expandProfile(profile, {}), error => error.code === 'team/invalid-action' && /Pass a goal/.test(error.message));
});

test('a profile names the task that has no objective', () => {
  const broken = { plan: { tasks: [{ taskId: 'panel' }] } };
  assert.throws(() => readProfile('broken', broken), error => error.code === 'team/invalid-action' && /"panel" needs an objective/.test(error.message));
  assert.throws(() => readProfile('', template), /Profile name is required/);
  assert.throws(() => readProfile('weird', []), /must be a JSON object/);
});

test('the task cap is enforced before the plan reaches the WAL', () => {
  const tasks = Array.from({ length: MAX_PROFILE_TASKS + 1 }, (_, index) => ({ taskId: 'task-' + index, objective: 'x' }));
  assert.throws(() => readProfile('big', { plan: { tasks } }), /the limit is 32/);
});

test('the listing line stays one line per profile', () => {
  assert.equal(describeProfile(readProfile('panel', template)), 'panel — Ship a panel (1 task · 1 member)');
  assert.equal(describeProfile(readProfile('bare', {})), 'bare (0 tasks · 0 members)');
});
