import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { TeamError } from '../core/errors.mjs';

/** Workspace-relative claim; anything anchored elsewhere is left as the executor wrote it. */
function anchored(locator) {
  if (typeof locator !== 'string' || locator.length === 0) return false;
  const parts = locator.split(/[\\/]+/);
  return !path.isAbsolute(locator) && !parts.includes('..');
}

export function contentDigest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function readDigest(root, locator) {
  try { return contentDigest(await readFile(path.resolve(root, locator))); }
  catch (cause) { return cause?.code === 'ENOENT' ? null : undefined; }
}

/**
 * Hash every workspace file the executor claims, so size and mtime cannot hide an edit.
 * A digest the caller supplied is a claim: a mismatch stops the completion before the WAL sees it.
 */
export async function sealEvidence({ root, evidence = [] }) {
  const sealed = [];
  for (const entry of evidence) {
    if (entry.kind !== 'file' || !anchored(entry.locator)) { sealed.push(entry); continue; }
    const actual = await readDigest(root, entry.locator);
    if (actual === null) throw new TeamError('team/invalid-state', 'Evidence file is missing: ' + entry.locator, { retryable: false });
    if (actual === undefined) { sealed.push(entry); continue; }
    if (entry.digest !== undefined && entry.digest !== actual) {
      throw new TeamError('team/invalid-state', 'Evidence digest does not match the workspace: ' + entry.locator, { retryable: false });
    }
    sealed.push({ ...entry, digest: actual });
  }
  return sealed;
}

/** Recompute recorded digests; a file edited without changing its size or mtime still reports drift. */
export async function auditEvidence({ root, entries = [] }) {
  const findings = [];
  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    const claim = { taskId: entry.taskId, attemptId: entry.attemptId, locator: entry.locator };
    if (!anchored(entry.locator)) { findings.push({ ...claim, status: 'outside' }); continue; }
    if (entry.digest === undefined) { findings.push({ ...claim, status: 'unstamped' }); continue; }
    const actual = await readDigest(root, entry.locator);
    if (actual === null) { findings.push({ ...claim, expected: entry.digest, status: 'missing' }); continue; }
    if (actual === undefined) { findings.push({ ...claim, expected: entry.digest, status: 'unreadable' }); continue; }
    findings.push({ ...claim, expected: entry.digest, actual, status: actual === entry.digest ? 'match' : 'drift' });
  }
  const open = findings.filter(item => item.status !== 'match' && item.status !== 'outside' && item.status !== 'unstamped');
  return { ok: open.length === 0, findings, drifted: open.filter(item => item.status === 'drift'), missing: open.filter(item => item.status === 'missing' || item.status === 'unreadable') };
}
