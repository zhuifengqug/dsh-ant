import { TeamError } from '../core/errors.mjs';
import { serializeError } from './context.mjs';

export const QUNCE_TOOL_PARAMETERS = {
  request: {
    type: 'json',
    description: 'Canonical Team action request validated by the durable Host service.',
    required: true,
  },
};

export const QUNCE_TOOL_OUTPUT = {
  schema: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          outcome: { type: 'string', enum: ['committed', 'duplicate'], required: true },
          requestId: { type: 'string', required: true },
          teamId: { type: 'string', required: true },
          firstEventSeq: { type: 'integer' },
          lastEventSeq: { type: 'integer' },
          eventIds: { type: 'array', items: { type: 'string' } },
          viewState: { type: 'string' },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string', required: true },
          message: { type: 'string', required: true },
          details: { type: 'json' },
        },
      },
    ],
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

/** Tool registration stays on the same Host service operation as /qunce. */
export function createQunceTool(service) {
  return {
    name: 'qunce_team_dispatch',
    description: 'Dispatch one Team action through the durable Tianshu Qunce Host service.',
    parameters: QUNCE_TOOL_PARAMETERS,
    output: QUNCE_TOOL_OUTPUT,
    async execute(args, exec) {
      if (!exec?.agent) {
        return serializeError(new TeamError('team/forbidden', 'qunce_team_dispatch requires a calling agent Session'));
      }
      try {
        return await service.dispatchAsAgent(args.request, exec.agent, exec.signal);
      } catch (error) {
        return serializeError(error);
      }
    },
  };
}
