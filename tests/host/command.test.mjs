import test from 'node:test';
import assert from 'node:assert/strict';
import { createAntCommand } from '../../src/host/command.mjs';

const view = {
  teamId: 'team-1', goal: 'Ship the colony', lifecycle: 'running', cursor: 7,
  releaseQueue: [{ taskId: 'task-a' }, { taskId: 'task-b' }],
  plan: { planId: 'plan-1', tasks: [
    { taskId: 'task-a', title: 'Ship the API' },
    { taskId: 'task-b', title: 'Ship the panel' },
    { taskId: 'task-c', title: 'Ship the docs' },
  ] },
  coverage: { counts: {}, tasks: [
    { taskId: 'task-a', state: 'reviewed', selfCompleted: true, pendingGates: ['review'] },
    { taskId: 'task-b', state: 'reviewed', selfCompleted: true, pendingGates: [] },
    { taskId: 'task-c', state: 'running', selfCompleted: false, pendingGates: ['review', 'integration'] },
  ] },
  summary: {
    goal: 'Ship the colony', lifecycle: 'running', planState: 'confirmed', halted: false,
    counts: { total: 3, running: 1, reviewed: 2, released: 0, failed: 0 },
    open: [{ attemptId: 'attempt-1', taskId: 'task-c', memberId: 'member-1', state: 'running' }],
    unread: { total: 2, toLead: 1, recent: [] },
    lastBatch: { batchId: 'batch-4', eventSeq: 5, taskIds: ['task-0'] },
    repairs: [], released: [],
  },
};

function stubService(overrides = {}) {
  const calls = [];
  return {
    calls,
    async list() { return { teams: [{ teamId: 'team-1', lifecycle: 'running' }] }; },
    async get(request) { calls.push(['get', request.teamId]); return { ...view, teamId: request.teamId }; },
    async dispatchAsOwner(request) { calls.push(['dispatchAsOwner', request]); return { outcome: 'committed', teamId: request.teamId, lastEventSeq: 9 }; },
    ...overrides,
  };
}

test('bare /ant prints the grammar instead of failing', async () => {
  const command = createAntCommand(stubService());
  const result = await command.handler({ rawInput: '  ' });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /\/ant status/);
});

test('/ant status reads the folded summary and names the only live team', async () => {
  const service = stubService();
  const command = createAntCommand(service);
  const result = await command.handler({ rawInput: 'status' });
  assert.equal(result.kind, 'success');
  assert.equal(result.sourceEventSeq, 7);
  assert.match(result.text, /Ship the colony · running/);
  assert.match(result.text, /plan confirmed · cursor 7/);
  assert.match(result.text, /tasks 3: 1 running · 2 reviewed/);
  assert.match(result.text, /open attempts 1 · unread 2 \(1 to the lead\)/);
  assert.match(result.text, /last batch batch-4 · 1 task @5/);
  assert.deepEqual(service.calls, [['get', 'team-1']]);
});

test('/ant plan lists every task with its state and open gates', async () => {
  const command = createAntCommand(stubService());
  const result = await command.handler({ rawInput: 'plan' });
  assert.match(result.text, /plan confirmed · 3 tasks/);
  assert.match(result.text, /· task-a reviewed Ship the API ✓ · gates: review/);
  assert.match(result.text, /· task-c running Ship the docs · gates: review, integration/);
});

test('/ant release closes the gate hall in one batch', async () => {
  const service = stubService();
  const command = createAntCommand(service);
  const result = await command.handler({ rawInput: 'release team-1' });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /released 2 tasks: task-a, task-b · seq 9/);
  const dispatched = service.calls.find(([kind]) => kind === 'dispatchAsOwner')[1];
  assert.equal(dispatched.action, 'batch.release');
  assert.equal(dispatched.payload.batchId, 'batch-8');
  assert.deepEqual(dispatched.payload.taskIds, ['task-a', 'task-b']);
  assert.match(dispatched.requestId, /^command-/);
});

test('/ant release says so when the gate hall is empty', async () => {
  const command = createAntCommand(stubService({ async get() { return { ...view, releaseQueue: [] }; } }));
  const result = await command.handler({ rawInput: 'release' });
  assert.equal(result.text, 'Nothing is waiting for release.');
});

test('/ant names the ambiguity instead of guessing between two teams', async () => {
  const command = createAntCommand(stubService({
    async list() { return { teams: [{ teamId: 'team-1', lifecycle: 'running' }, { teamId: 'team-2', lifecycle: 'running' }] }; },
  }));
  const result = await command.handler({ rawInput: 'status' });
  assert.equal(result.kind, 'error');
  const error = JSON.parse(result.text);
  assert.equal(error.code, 'team/invalid-action');
  assert.match(error.message, /team-1, team-2/);
});

test('/ant audit re-hashes the recorded deliverables and names the drift', async () => {
  const command = createAntCommand(stubService({
    async auditArtifacts(request) {
      assert.equal(request.teamId, 'team-1');
      return { teamId: 'team-1', ok: false, findings: [
        { taskId: 'task-a', attemptId: 'attempt-1', locator: 'src/api.mjs', expected: 'aa', actual: 'bb', status: 'drift' },
        { taskId: 'task-b', attemptId: 'attempt-2', locator: 'docs/panel.md', expected: 'cc', actual: 'cc', status: 'match' },
      ], drifted: [{ locator: 'src/api.mjs' }], missing: [] };
    },
  }));
  const result = await command.handler({ rawInput: 'audit' });
  assert.equal(result.kind, 'success');
  assert.match(result.text, /1 claim no longer match · 1 claim unchanged/);
  assert.match(result.text, /· src\/api\.mjs drift \(task-a\)/);
});

test('/ant audit says nothing when every digest still matches', async () => {
  const command = createAntCommand(stubService({
    async auditArtifacts() {
      return { ok: true, findings: [{ locator: 'a.mjs', status: 'match' }], drifted: [], missing: [] };
    },
  }));
  const result = await command.handler({ rawInput: 'audit team-1' });
  assert.equal(result.text, 'Every recorded file still matches its digest (1 claim).');
});

test('a JSON body still dispatches verbatim', async () => {
  const service = stubService();
  const command = createAntCommand(service);
  const result = await command.handler({ rawInput: JSON.stringify({ requestId: 'cmd-json', teamId: 'team-1', action: 'team.halt', payload: { reason: 'stop' } }) });
  assert.equal(result.kind, 'success');
  assert.equal(JSON.parse(result.text).outcome, 'committed');
  assert.equal(service.calls[0][1].action, 'team.halt');
});
