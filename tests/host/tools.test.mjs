import test from 'node:test';
import assert from 'node:assert/strict';
import { createAntTools } from '../../src/host/tool.mjs';

const service = {
  async get() { return { teamId: 'team-1', cursor: 0, spend: [] }; },
  async list() { return []; },
  async dispatchAsAgent() { return { outcome: 'committed' }; },
  async dispatch(input) { return { outcome: 'committed', requestId: input.requestId, teamId: input.teamId, lastEventSeq: 1 }; },
};

test('every Ant tool shares the ant_ prefix and a unique name', () => {
  const tools = createAntTools(service);
  const names = tools.map(tool => tool.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^ant_[a-z_]+$/);
  assert.deepEqual(names.sort(), ['ant_team_dispatch', 'ant_team_get', 'ant_team_list', 'ant_team_release', 'ant_team_schedule', 'ant_team_spend']);
});

test('help text names the ant_ tools it is documented under', () => {
  const tools = createAntTools(service);
  const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
  assert.match(byName.ant_team_get.description, /Team view/);
  assert.match(byName.ant_team_dispatch.parameters.request.description, /Team action request/);
  for (const tool of tools) assert.ok(tool.description && tool.description.length > 10);
});

test('ant_team_spend reports the summary of the read-only view', async () => {
  const tool = createAntTools(service).find(item => item.name === 'ant_team_spend');
  const result = await tool.execute({ teamId: 'team-1' });
  assert.equal(result.attempts, 0);
  assert.equal(result.unknown, 0);
});
