import { TeamError } from '../core/errors.mjs';
import { runSchedule, releaseBatch } from '../core/scheduler.mjs';
import { summarizeSpend } from '../core/spend.mjs';
import { serializeError } from './context.mjs';

export const ANT_TOOL_PARAMETERS = {
  request: {
    type: 'json',
    description: 'Canonical Team action request validated by the durable Host service.',
    required: true,
  },
};

export const ANT_TOOL_OUTPUT = {
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

export const ANT_RESULT_OUTPUT = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
};

const teamIdParameter = { type: 'string', description: 'Team identity returned by ant_team_dispatch.', required: true };

/** Every Ant surface shares one verb-shaped ant_ prefix and one Host service. */
export function createAntTools(service) {
  return [
    createAntTool(service),
    {
      name: 'ant_team_get',
      description: 'Read one Team view: lifecycle, tasks, attempts, mailbox, reviews, spend and cursor.',
      parameters: { teamId: teamIdParameter },
      output: ANT_RESULT_OUTPUT,
      async execute(args) {
        try {
          return await service.get({ teamId: args.teamId });
        } catch (error) {
          return serializeError(error);
        }
      },
    },
    {
      name: 'ant_team_list',
      description: 'List every live Team, optionally including archived ones.',
      parameters: { includeArchived: { type: 'boolean', description: 'Include archived teams.' } },
      output: ANT_RESULT_OUTPUT,
      async execute(args) {
        try {
          return await service.list({ includeArchived: args.includeArchived === true });
        } catch (error) {
          return serializeError(error);
        }
      },
    },
    {
      name: 'ant_team_spend',
      description: 'Summarize recorded cost by member, task and attempt; unknown usage stays unknown.',
      parameters: { teamId: teamIdParameter },
      output: ANT_RESULT_OUTPUT,
      async execute(args) {
        try {
          return summarizeSpend(await service.get({ teamId: args.teamId }));
        } catch (error) {
          return serializeError(error);
        }
      },
    },
    {
      name: 'ant_team_schedule',
      description: 'Run one scheduling tick: wake stalled members, then start ready tasks with free members and slots.',
      parameters: { teamId: teamIdParameter },
      output: ANT_RESULT_OUTPUT,
      async execute(args) {
        try {
          return await runSchedule({ service, teamId: args.teamId });
        } catch (error) {
          return serializeError(error);
        }
      },
    },
    {
      name: 'ant_team_release',
      description: 'Release a batch of reviewed tasks as the owner, then dispatch whatever the release unblocked.',
      parameters: { teamId: teamIdParameter, taskIds: { type: 'array', items: { type: 'string' }, description: 'Task identities to release.', required: true } },
      output: ANT_RESULT_OUTPUT,
      async execute(args) {
        try {
          return await releaseBatch({ service, teamId: args.teamId, taskIds: args.taskIds });
        } catch (error) {
          return serializeError(error);
        }
      },
    },
  ];
}

/** Tool registration stays on the same Host service operation as /ant. */
export function createAntTool(service) {
  return {
    name: 'ant_team_dispatch',
    description: 'Dispatch one Team action through the durable Amber Ant Host service.',
    parameters: ANT_TOOL_PARAMETERS,
    output: ANT_TOOL_OUTPUT,
    async execute(args, exec) {
      if (!exec?.agent) {
        return serializeError(new TeamError('team/forbidden', 'ant_team_dispatch requires a calling agent Session'));
      }
      try {
        return await service.dispatchAsAgent(args.request, exec.agent, exec.signal);
      } catch (error) {
        return serializeError(error);
      }
    },
  };
}
