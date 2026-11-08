import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLACEHOLDER, scaffoldFiles, seedMembers, seedPlan, teamCreateRequest } from '../../src/core/template.mjs';
import { validatePlan } from '../../src/core/plan.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(repo, 'tools/ant-scaffold.mjs');
const stale = new RegExp(PLACEHOLDER.source, 'i');
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ant-scaffold-'));
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
const walk = (dir, base = '') => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name), base + entry.name + '/') : [base + entry.name]);

test('the node scaffold renders every file with no placeholder left', () => {
  const files = scaffoldFiles({ name: 'demo', scope: '@acme', summary: '演示仓库' });
  const paths = files.map(file => file.path);
  assert.equal(files.length, 15);
  assert.equal(new Set(paths).size, 15);
  assert.deepEqual(files.filter(file => stale.test(file.contents)).map(file => file.path), []);
  const pkg = JSON.parse(files.find(file => file.path === 'package.json').contents);
  assert.equal(pkg.name, '@acme/demo');
  assert.equal(pkg.scripts.test, 'node --test');
  assert.match(files.find(file => file.path === 'AGENTS.md').contents, /^# demo/);
});

test('the bare scaffold drops the node-only files', () => {
  const paths = scaffoldFiles({ name: 'notes', lang: 'none' }).map(file => file.path);
  assert.equal(paths.length, 12);
  assert.equal(paths.includes('package.json'), false);
  assert.equal(paths.includes('tests/smoke.test.mjs'), false);
  assert.equal(paths.includes('.github/workflows/gates.yml'), false);
});

test('the seeded plan passes validation and its verify matches the emitted scripts', () => {
  const options = { name: 'demo', lang: 'node' };
  const plan = seedPlan(options);
  validatePlan(plan, seedMembers(options));
  const files = scaffoldFiles(options);
  const scripts = JSON.parse(files.find(file => file.path === 'package.json').contents).scripts;
  const verify = plan.tasks.flatMap(task => task.verify);
  for (const command of verify.filter(item => !item.startsWith('git '))) {
    const ok = command.startsWith('npm run ') ? Boolean(scripts[command.slice(8)]) : Object.values(scripts).includes(command);
    assert.ok(ok, 'verify command has no script: ' + command);
  }
  assert.deepEqual(plan.tasks.map(task => task.taskId), ['spec', 'core', 'ship']);
  assert.deepEqual(plan.qualityGates.map(gate => gate.kind), ['verification', 'verification', 'review', 'integration']);
  const request = teamCreateRequest(options);
  assert.equal(request.action, 'team.create');
  assert.equal(request.payload.members.length, 3);
  assert.equal(request.payload.members[0].role, '蚁后');
});

test('the cli refuses a non-empty target and writes nothing', () => {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, 'target'));
  fs.writeFileSync(path.join(dir, 'target', 'AGENTS.md'), 'existing');
  const refused = run(['--target', 'target', '--name', 'demo'], dir);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /撞名: AGENTS\.md/);
  assert.equal(fs.readFileSync(path.join(dir, 'target', 'AGENTS.md'), 'utf8'), 'existing');
});

test('the cli writes the scaffold and prints the create request', () => {
  const dir = scratch();
  const done = run(['--target', 'demo', '--name', 'demo', '--summary', '演示'], dir);
  assert.equal(done.status, 0, done.stderr);
  const request = JSON.parse(done.stdout);
  assert.equal(request.action, 'team.create');
  assert.equal(request.payload.goal, '演示');
  assert.equal(walk(path.join(dir, 'demo')).length, 15);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'demo', '.ant', 'plan.json'), 'utf8')).tasks.length, 3);
});

test('--force rewrites template files and leaves foreign files alone', () => {
  const dir = scratch();
  const target = path.join(dir, 'demo');
  assert.equal(run(['--target', 'demo', '--name', 'demo'], dir).status, 0);
  fs.writeFileSync(path.join(target, 'NOTES.md'), 'mine');
  fs.writeFileSync(path.join(target, 'AGENTS.md'), 'clobbered');
  const forced = run(['--target', 'demo', '--name', 'demo', '--force'], dir);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(fs.readFileSync(path.join(target, 'NOTES.md'), 'utf8'), 'mine');
  assert.match(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8'), /^# demo/);
});
