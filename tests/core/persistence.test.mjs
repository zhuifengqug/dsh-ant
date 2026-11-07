import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { TeamWriterLease } from '../../src/core/writer-lease.mjs';
import { TeamWal } from '../../src/core/wal.mjs';
import { canonicalize, digest, stableTeamId } from '../../src/core/canonical.mjs';
import { parseRequest, parseList, ACTIONS } from '../../src/core/codec.mjs';

const childFile = fileURLToPath(new URL('./lease-child.mjs', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-core-'));
  const lease = new TeamWriterLease();
  const token = await lease.acquire(root, 'test-host');
  t.after(async () => { await lease.release(token.ownerId, token.epoch, token.fencingToken); await rm(root, { recursive: true, force: true }); });
  return { root, lease, token, wal: new TeamWal({ lease, token }) };
}
const actor = { actor: 'user', principal: { kind: 'owner' } };
const request = (requestId, expectedEventSeq) => ({ requestId, teamId: 'team-test', action: 'mail.read', payload: { messageId: 'message-1' }, ...(expectedEventSeq === undefined ? {} : { expectedEventSeq }) });
const decide = () => [{ type: 'test.changed', payload: { value: 1 } }];
async function child(root, mode) {
  const proc = spawn(process.execPath, [childFile, root, ...(mode ? [mode] : [])], { stdio: ['pipe', 'pipe', 'pipe'] });
  const report = await new Promise((resolve, reject) => {
    let output = '';
    proc.stdout.on('data', chunk => { output += chunk; if (output.includes('\n')) resolve(JSON.parse(output.slice(0, output.indexOf('\n')))); });
    proc.once('error', reject);
    proc.once('exit', code => { if (!output.includes('\n')) reject(new Error(`Child exited ${code}`)); });
  });
  return { proc, report };
}

test('canonical JSON sorts UTF-16 keys and matches numeric/string JCS examples', () => {
  assert.equal(canonicalize({ numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001], z: -0, a: '\u20ac$\u000f\nA\'B"\\"/' }), '{"a":"€$\\u000f\\nA\'B\\"\\\\\\"/","numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"z":0}');
  assert.equal(digest({ b: 2, a: 1 }), digest({ a: 1, b: 2 }));
  for (const value of [NaN, Infinity, undefined, '\ud800', new Date(), { a: undefined }]) assert.throws(() => canonicalize(value), { code: 'team/invalid-action' });
  const spoofedMembers = [{ memberId: 'm', role: 'engineer', sessionMode: 'persistent', provider: 'deepseek', model: 'deepseek-v4', inScope: [], outOfScope: [], toJSON: () => 'spoof' }];
  assert.throws(() => parseRequest({ requestId: 'spoof', action: 'team.create', payload: { ...({ goal: 'g', workspaceRelativePath: '.', plan: { planId: 'p', mode: 'normal', maxActiveAttempts: 1, tasks: [], dependencies: [], qualityGates: [] } }), members: spoofedMembers } }), { code: 'team/invalid-action' });
  assert.equal(stableTeamId('root', 'req'), stableTeamId('root', 'req'));
});

test('strict nested action codec rejects spoofed authority and cross-action payloads', () => {
  assert.equal(ACTIONS.length, 26);
  const good = request('request-1');
  assert.deepEqual(parseRequest(good), good);
  for (const wrong of [{ ...good, principal: { kind: 'owner' } }, { ...good, payload: { memberId: 'm' } }, { ...good, action: 'team.delete', payload: { messageId: 'x' } }, { ...good, action: 'unknown' }]) assert.throws(() => parseRequest(wrong), { code: 'team/invalid-action' });
  assert.throws(() => parseList({ workspaceRoot: 'C:\\other' }), { code: 'team/invalid-action' });
});

test('second real process conflicts, epoch increments after release, old fencing fails', async t => {
  const { root, lease, token } = await fixture(t);
  const conflict = await child(root);
  const [exitCode] = await once(conflict.proc, 'exit');
  assert.equal(exitCode, 2);
  assert.equal(conflict.report.code, 'team/lease-conflict');
  await lease.release(token.ownerId, token.epoch, token.fencingToken);
  const successor = await child(root);
  await once(successor.proc, 'exit');
  assert.equal(successor.report.ok, true);
  assert.equal(successor.report.token.epoch, token.epoch + 1);
  await assert.rejects(lease.assert(token), { code: 'team/lease-lost' });
});

test('killed writer releases OS lease without stale-timeout theft', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-crash-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await child(root, 'hold');
  const stopped = once(first.proc, 'exit');
  first.proc.kill('SIGKILL');
  await stopped;
  const lease = new TeamWriterLease();
  const token = await lease.acquire(root, 'successor');
  assert.equal(token.epoch, first.report.token.epoch + 1);
  await lease.release(token.ownerId, token.epoch, token.fencingToken);
});

test('lease port override is rejected at the canonical owner', () => {
  assert.throws(() => new TeamWriterLease({ port: 49321 }), { code: 'team/invalid-action' });
});

test('corrupt writer metadata maps to stable lease-lost', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ant-lease-meta-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, '.writer.json'), '{broken');
  const lease = new TeamWriterLease();
  await assert.rejects(lease.acquire(root, 'broken-metadata-host'), { code: 'team/lease-lost' });
});

test('lease admits independent operations concurrently and drains before release', async t => {
  const { lease, token } = await fixture(t);
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  let unblock;
  const barrier = new Promise(resolve => { unblock = resolve; });
  const first = lease.guard(token, async () => { started(); await barrier; return 'first'; });
  await entered;
  const second = await lease.guard(token, async () => 'second');
  assert.equal(second, 'second');
  let released = false;
  const closing = lease.release(token.ownerId, token.epoch, token.fencingToken).then(() => { released = true; });
  await assert.rejects(lease.guard(token, async () => 'late'), { code: 'team/lease-lost' });
  assert.equal(released, false);
  unblock();
  assert.equal(await first, 'first');
  await closing;
  assert.deepEqual(await lease.status(), {});
});

test('transaction file commits events and original duplicate receipt; stale/conflict do not append', async t => {
  const { wal } = await fixture(t);
  const first = await wal.transact('team-test', request('request-1', 0), actor, decide);
  const second = await wal.transact('team-test', request('request-1', 0), actor, () => { throw Error('duplicate must not decide'); });
  assert.deepEqual(second, { ...first, outcome: 'duplicate' });
  await assert.rejects(wal.transact('team-test', { ...request('request-1', 0), payload: { messageId: 'different' } }, actor, decide), { code: 'team/duplicate-request-conflict' });
  await assert.rejects(wal.transact('team-test', request('request-2', 0), actor, decide), { code: 'team/stale-cursor' });
  assert.equal((await wal.read('team-test')).cursor, 1);
  assert.equal((await readdir(path.join(wal.directory('team-test'), 'events'))).filter(name => name.endsWith('.json')).length, 1);
});

test('concurrent actions serialize per team and replay continuous event generation', async t => {
  const { wal } = await fixture(t);
  await Promise.all(Array.from({ length: 30 }, (_, index) => wal.transact('team-test', request(`request-${index}`), actor, decide)));
  const history = await wal.read('team-test');
  assert.equal(history.cursor, 30);
  assert.deepEqual(history.events.map(event => event.eventSeq), Array.from({ length: 30 }, (_, index) => index + 1));
  assert.equal(new Set(history.events.map(event => event.eventId)).size, 30);
});

test('two WAL facades sharing one lease serialize the same team queue', async t => {
  const { lease, token, wal } = await fixture(t);
  const second = new TeamWal({ lease, token });
  await Promise.all([
    ...Array.from({ length: 10 }, (_, index) => wal.transact('team-test', request(`left-${index}`), actor, decide)),
    ...Array.from({ length: 10 }, (_, index) => second.transact('team-test', request(`right-${index}`), actor, decide)),
  ]);
  const history = await wal.read('team-test');
  assert.equal(history.cursor, 20);
  assert.deepEqual(history.events.map(event => event.eventSeq), Array.from({ length: 20 }, (_, index) => index + 1));
});

test('multi-event transaction is one replay unit and uncommitted temporary is ignored', async t => {
  const { wal } = await fixture(t);
  await wal.transact('team-test', request('batch'), actor, () => [...decide(), ...decide()]);
  await writeFile(path.join(wal.directory('team-test'), 'events', '.txn-01234567.tmp'), '{partial');
  const history = await wal.read('team-test');
  assert.equal(history.cursor, 2);
  assert.equal(history.receipts.length, 1);
  assert.equal(history.events[1].causationId, history.events[0].eventId);
});

test('tampered record checksum blocks replay and later append', async t => {
  const { wal } = await fixture(t);
  await wal.transact('team-test', request('initial'), actor, decide);
  const file = path.join(wal.directory('team-test'), 'events', '0000000000000001.json');
  const record = JSON.parse(await readFile(file, 'utf8'));
  record.events[0].payload.value = 99;
  await writeFile(file, JSON.stringify(record));
  await assert.rejects(wal.read('team-test'), { code: 'team/rebuild-required' });
  await assert.rejects(wal.transact('team-test', request('later'), actor, decide), { code: 'team/rebuild-required' });
});

test('snapshot is validated against WAL cut; stale snapshot discarded', async t => {
  const { wal } = await fixture(t);
  assert.equal(await wal.readSnapshot('team-test'), undefined);
  await wal.transact('team-test', request('first'), actor, decide);
  const firstCut = await wal.read('team-test');
  await wal.writeSnapshot('team-test', { title: 'one' }, firstCut);
  assert.deepEqual(await wal.readSnapshot('team-test'), { title: 'one' });
  await wal.transact('team-test', request('second'), actor, decide);
  assert.equal(await wal.readSnapshot('team-test'), undefined);
  const secondCut = await wal.read('team-test');
  await wal.writeSnapshot('team-test', { title: 'two' }, secondCut);
  assert.deepEqual(await wal.readSnapshot('team-test'), { title: 'two' });
  await writeFile(path.join(wal.directory('team-test'), 'snapshot.json'), '{broken');
  await assert.rejects(wal.readSnapshot('team-test'), { code: 'team/rebuild-required' });
});
