/** The one settings file the panel and the host share: $DSH_HOME/ant.json. */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { TeamError } from '../core/errors.mjs';
import { SETTING_LIMITS } from '../core/autonomy.mjs';

export const DEFAULT_SETTINGS = Object.freeze({
  autonomy: 'L2',
  batchWindowMinutes: 30,
  maxActiveAttempts: 8,
  defaultVariants: 1,
  variantWriteTasks: false,
});

const AUTONOMY_LEVELS = new Set(['L1', 'L2', 'L3']);

function fail(message) {
  return new TeamError('team/invalid-action', message, { retryable: false });
}

function checkInteger(key, value) {
  const [minimum, maximum] = SETTING_LIMITS[key];
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw fail(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

/** Merge a patch over a base, rejecting anything the host would not honour. */
export function normalizeSettings(patch = {}, base = DEFAULT_SETTINGS) {
  const merged = { ...base, ...patch };
  if (!AUTONOMY_LEVELS.has(merged.autonomy)) throw fail('autonomy must be L1, L2 or L3');
  return Object.freeze({
    autonomy: merged.autonomy,
    batchWindowMinutes: checkInteger('batchWindowMinutes', merged.batchWindowMinutes),
    maxActiveAttempts: checkInteger('maxActiveAttempts', merged.maxActiveAttempts),
    defaultVariants: checkInteger('defaultVariants', merged.defaultVariants),
    variantWriteTasks: merged.variantWriteTasks === true,
  });
}

/** $DSH_HOME when set and non-blank, otherwise ~/.dsh — the harness keeps user data under one root. */
export function defaultHome(env = {}) {
  const configured = env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  return path.join(homedir(), '.dsh');
}

/**
 * Settings are re-read before every action, so an edit applies without a restart.
 * The stat check keeps that cheap: an unchanged file is not re-parsed.
 */
export function createSettingsStore({ home, file, env = process.env } = {}) {
  const resolvedFile = file ?? path.join(home ?? defaultHome(env), 'ant.json');
  let cached;
  let stamp;

  const read = async () => {
    let info;
    try { info = await stat(resolvedFile); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return DEFAULT_SETTINGS;
    }
    const current = `${info.mtimeMs}:${info.size}`;
    if (cached && stamp === current) return cached;
    let parsed;
    try { parsed = JSON.parse(await readFile(resolvedFile, 'utf8')); }
    catch (error) { throw fail(`Settings file is not valid JSON: ${error.message}`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw fail('Settings file must contain a JSON object');
    cached = normalizeSettings(parsed);
    stamp = current;
    return cached;
  };

  const write = async patch => {
    const next = normalizeSettings(patch, await read());
    await mkdir(path.dirname(resolvedFile), { recursive: true });
    const temporary = `${resolvedFile}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await rename(temporary, resolvedFile);
    cached = next;
    stamp = undefined;
    return next;
  };

  return { file: resolvedFile, read, write };
}
