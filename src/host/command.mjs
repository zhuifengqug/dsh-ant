import { TeamError } from '../core/errors.mjs';
import { serializeError } from './context.mjs';

function parseInput(rawInput) {
  const text = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (!text) throw new TeamError('team/invalid-action', 'Usage: /qunce <JSON team action request>');
  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new TeamError('team/invalid-action', `Invalid /qunce request: ${cause.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TeamError('team/invalid-action', 'The /qunce request must be a JSON object');
  }
  return value;
}

function formatResult(receipt) {
  return JSON.stringify(receipt);
}

export function createQunceCommand(service) {
  return {
    definitionId: '@zhuifengqug/dsh-tianshu-qunce/command-qunce',
    name: 'qunce',
    description: 'Dispatch one Tianshu Qunce Team action as JSON.',
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
