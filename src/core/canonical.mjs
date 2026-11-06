import { createHash } from 'node:crypto';
import { TeamError } from './errors.mjs';

function validString(value) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TeamError('team/invalid-action', 'Unpaired Unicode surrogate');
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TeamError('team/invalid-action', 'Unpaired Unicode surrogate');
    }
  }
  return JSON.stringify(value);
}

/** RFC 8785 JSON data model: finite IEEE-754 numbers, UTF-16 key sorting. */
export function canonicalize(value) {
  const ancestors = new Set();
  function encode(item) {
    if (item === null) return 'null';
    if (typeof item === 'string') return validString(item);
    if (typeof item === 'boolean') return String(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object') throw new TeamError('team/invalid-action', 'Expected JSON data');
    if (ancestors.has(item)) throw new TeamError('team/invalid-action', 'Cyclic JSON data');
    const proto = Object.getPrototypeOf(item);
    if (Object.getOwnPropertySymbols(item).length) throw new TeamError('team/invalid-action', 'Symbol JSON key');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if ('get' in descriptor || 'set' in descriptor) throw new TeamError('team/invalid-action', 'Accessor JSON property');
      if (Array.isArray(item)) {
        if (key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)) throw new TeamError('team/invalid-action', 'Non-index array property');
      } else if (!descriptor.enumerable) throw new TeamError('team/invalid-action', 'Non-enumerable JSON property');
    }
    if (!Array.isArray(item) && proto !== Object.prototype && proto !== null) {
      throw new TeamError('team/invalid-action', 'Expected a plain JSON object');
    }
    ancestors.add(item);
    let result;
    if (Array.isArray(item)) {
      const values = [];
      if (proto !== Array.prototype) throw new TeamError('team/invalid-action', 'Non-standard JSON array');
      for (let i = 0; i < item.length; i++) {
        if (!Object.hasOwn(item, i)) throw new TeamError('team/invalid-action', 'Sparse JSON array');
        values.push(encode(item[i]));
      }
      result = `[${values.join(',')}]`;
    } else {
      if (Object.getOwnPropertySymbols(item).length) throw new TeamError('team/invalid-action', 'Symbol JSON key');
      result = `{${Object.keys(item).sort().map(key => `${validString(key)}:${encode(item[key])}`).join(',')}}`;
    }
    ancestors.delete(item);
    return result;
  }
  return encode(value);
}

export function digest(value) {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}

export function requestDigest(request) {
  const data = { action: request.action, payload: request.payload };
  if (request.teamId !== undefined) data.teamId = request.teamId;
  if (request.expectedEventSeq !== undefined) data.expectedEventSeq = request.expectedEventSeq;
  return digest(data);
}

export function stableTeamId(workspaceIdentity, requestId) {
  return `team-${digest({ workspaceIdentity, requestId }).slice(0, 32)}`;
}

export function stableMailRequestId(teamId, messageId) {
  return `ant-mail-${digest({ teamId, messageId }).slice(0, 40)}`;
}

export function stableMailAdmissionRequestId(teamId, messageId) {
  return `ant-admit-${digest({ teamId, messageId }).slice(0, 40)}`;
}
