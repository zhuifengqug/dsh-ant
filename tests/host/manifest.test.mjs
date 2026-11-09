import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

/** Semver precedence for the shapes a DSH host ships: x.y.z, optionally with a prerelease tag. */
function compare(left, right) {
  const parse = value => {
    const [core, tag] = value.trim().split('-', 2);
    const [major, minor, patch] = core.split('.').map(Number);
    return { major, minor, patch, tag: tag ? tag.split('.') : [] };
  };
  const a = parse(left); const b = parse(right);
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  if (a.tag.length === 0 && b.tag.length === 0) return 0;
  if (a.tag.length === 0) return 1;
  if (b.tag.length === 0) return -1;
  for (let index = 0; index < Math.max(a.tag.length, b.tag.length); index += 1) {
    const left2 = a.tag[index]; const right2 = b.tag[index];
    if (left2 === undefined) return -1;
    if (right2 === undefined) return 1;
    const numeric = Number.isInteger(Number(left2)) && Number.isInteger(Number(right2));
    if (left2 === right2) continue;
    if (numeric) return Number(left2) < Number(right2) ? -1 : 1;
    if (Number.isInteger(Number(left2))) return -1;
    if (Number.isInteger(Number(right2))) return 1;
    return left2 < right2 ? -1 : 1;
  }
  return 0;
}

function floorAndCeiling(range) {
  const [floor, ceiling] = range.split(' ');
  return { floor: floor.replace(/^>=/, ''), ceiling: ceiling ? ceiling.replace(/^</, '') : undefined };
}

test('the host version gate accepts every 0.2 release candidate and refuses the next minor', () => {
  const range = manifest.engines?.dsh;
  assert.equal(typeof range, 'string');
  const { floor, ceiling } = floorAndCeiling(range);
  for (const version of ['0.2.2-rc.1', '0.2.2', '0.2.3', '0.2.3-rc.1', '0.2.9']) {
    assert.equal(compare(version, floor) >= 0, true, version + ' >= ' + floor);
    if (ceiling) assert.equal(compare(version, ceiling) < 0, true, version + ' < ' + ceiling);
  }
  assert.equal(compare('0.2.1', floor) >= 0, false);
  if (ceiling) assert.equal(compare('0.3.0', ceiling) < 0, false);
});

test('host packages stay wildcards so the installed host supplies them', () => {
  const peers = manifest.peerDependencies ?? {};
  for (const [name, range] of Object.entries(peers)) {
    if (name === '@deepseek-ai/cordis' || !name.startsWith('@deepseek-ai/dsh')) continue;
    assert.equal(range, '*', name);
  }
  assert.equal(peers['@deepseek-ai/cordis'], '^4.1.0');
});
