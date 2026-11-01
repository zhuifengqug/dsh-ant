import { z } from 'zod';

export const PACKAGE_NAME = '@zhuifengqug/dsh-tianshu-qunce';

const requestSchema = z.record(z.string(), z.unknown());
const resultSchema = z.record(z.string(), z.unknown());
const getSchema = z.strictObject({
  teamId: z.string().min(1),
  atLeastEventSeq: z.number().int().nonnegative().optional(),
});
const listSchema = z.strictObject({
  includeArchived: z.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const requestJsonSchema = {
  type: 'object',
  additionalProperties: true,
};
const resultJsonSchema = { type: 'object', additionalProperties: true };

export function createTypertSpec() {
  return {
    package: PACKAGE_NAME,
    methods: {
      'team/dispatch': {
        service: 'tianshuQunce',
        implementation: 'dispatch',
        description: 'Dispatch one durable Tianshu Qunce Team action.',
        invocation: { kind: 'direct' },
        parameters: [{
          name: 'request',
          description: 'Canonical Team action request.',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: `${PACKAGE_NAME}/types#TeamDispatchRequest`,
            create: () => requestSchema,
            jsonSchema: requestJsonSchema,
          },
          strictCodec: {
            mode: 'strict',
            typeSymbol: `${PACKAGE_NAME}/types#TeamDispatchRequest`,
            create: () => requestSchema,
            jsonSchema: requestJsonSchema,
          },
        }],
        result: {
          mode: 'strict',
          typeSymbol: `${PACKAGE_NAME}/types#TeamDispatchReceipt`,
          create: () => resultSchema,
          jsonSchema: resultJsonSchema,
        },
        cancellation: { parameter: 'signal' },
      },
      'team/get': {
        service: 'tianshuQunce',
        implementation: 'get',
        description: 'Read one durable Tianshu Qunce Team view.',
        invocation: { kind: 'direct' },
        parameters: [{
          name: 'request',
          description: 'Team identity and optional cursor.',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: `${PACKAGE_NAME}/types#TeamGetRequest`,
            create: () => getSchema,
            jsonSchema: { type: 'object', properties: { teamId: { type: 'string', 'minLength': 1 }, atLeastEventSeq: { type: 'integer', minimum: 0 } }, required: ['teamId'], additionalProperties: true },
          },
          strictCodec: {
            mode: 'strict',
            typeSymbol: `${PACKAGE_NAME}/types#TeamGetRequest`,
            create: () => getSchema,
            jsonSchema: { type: 'object', properties: { teamId: { type: 'string', 'minLength': 1 }, atLeastEventSeq: { type: 'integer', minimum: 0 } }, required: ['teamId'], additionalProperties: false },
          },
        }],
        result: {
          mode: 'strict',
          typeSymbol: `${PACKAGE_NAME}/types#TeamView`,
          create: () => resultSchema,
          jsonSchema: resultJsonSchema,
        },
        cancellation: { parameter: 'signal' },
      },
      'team/list': {
        service: 'tianshuQunce',
        implementation: 'list',
        description: 'List durable Tianshu Qunce Teams.',
        invocation: { kind: 'direct' },
        parameters: [{
          name: 'request',
          description: 'Team list filter and cursor.',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: `${PACKAGE_NAME}/types#TeamListRequest`,
            create: () => listSchema,
            jsonSchema: { type: 'object', properties: { includeArchived: { type: 'boolean' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: true },
          },
          strictCodec: {
            mode: 'strict',
            typeSymbol: `${PACKAGE_NAME}/types#TeamListRequest`,
            create: () => listSchema,
            jsonSchema: { type: 'object', properties: { includeArchived: { type: 'boolean' }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
          },
        }],
        result: {
          mode: 'strict',
          typeSymbol: `${PACKAGE_NAME}/types#TeamListResult`,
          create: () => resultSchema,
          jsonSchema: resultJsonSchema,
        },
        cancellation: { parameter: 'signal' },
      },
    },
  };
}
