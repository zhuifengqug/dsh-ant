import { TeamError } from '../core/errors.mjs';
import { serializeError } from './context.mjs';

function parseInput(rawInput) {
  const text = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (!text) throw new TeamError('team/invalid-action', 'Usage: /ant <JSON team action request>');
  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new TeamError('team/invalid-action', `Invalid /ant request: ${cause.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TeamError('team/invalid-action', 'The /ant request must be a JSON object');
  }
  return value;
}

function formatResult(receipt) {
  return JSON.stringify(receipt);
}

export function createAntCommand(service) {
  return {
    definitionId: '@zhuifengqug/dsh-ant/command-ant',
    name: 'ant',
    description: 'Dispatch one Amber Ant Team action as JSON.',
    input: { hint: '<JSON team action request>', attachments: false },
    handler: async invocation => {
      try {
        const request = parseInput(invocation.rawInput);
        const receipt = await service.dispatchAsOwner(request, invocation.signal);
        return { kind: 'success', text: formatResult(receipt), sourceEventSeq: receipt.lastEventSeq };
      } catch (error) {
        return { kind: 'error', text: JSON.stringify(serializeError(error)) };
      }
    },
  };
}
