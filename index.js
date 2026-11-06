import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createAntCommand } from './src/host/command.mjs';
import { createAntTool, ANT_TOOL_PARAMETERS, ANT_TOOL_OUTPUT } from './src/host/tool.mjs';
import { AntService } from './src/host/service.mjs';

export const name = 'ant';
export const inject = ['commands', 'tools', 'sessionController'];
export const Config = z.object({
  workspaceRoot: z.string().default(process.cwd()),
  ownerId: z.string().default('ant-host'),
  includeArchived: z.boolean().default(false),
});

/** Host-only bundle entry. Cordis owns every registration and cleanup. */
export function apply(ctx, config = {}) {
  const service = new AntService(ctx, config);
  ctx.effect(() => async () => {
    await service.close();
  }, 'ant: service');
  ctx.effect(() => ctx.commands.register(createAntCommand(service)), 'ant: command');
  ctx.effect(() => ctx.tools.register(defineTool(createAntTool(service))), 'ant: tool');
}

export { AntService, ANT_TOOL_PARAMETERS, ANT_TOOL_OUTPUT };
export { TYPERT } from './typert.host.mjs';
