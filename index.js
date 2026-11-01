import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createQunceCommand } from './src/host/command.mjs';
import { createQunceTool, QUNCE_TOOL_PARAMETERS, QUNCE_TOOL_OUTPUT } from './src/host/tool.mjs';
import { TianshuQunceService } from './src/host/service.mjs';

export const name = 'tianshu-qunce';
export const inject = ['commands', 'tools', 'sessionController'];
export const Config = z.object({
  workspaceRoot: z.string().default(process.cwd()),
  ownerId: z.string().default('tianshu-qunce-host'),
  includeArchived: z.boolean().default(false),
});

/** Host-only bundle entry. Cordis owns every registration and cleanup. */
export function apply(ctx, config = {}) {
  const service = new TianshuQunceService(ctx, config);
  ctx.effect(() => async () => {
    await service.close();
  }, 'tianshu-qunce: service');
  ctx.effect(() => ctx.commands.register(createQunceCommand(service)), 'tianshu-qunce: command');
  ctx.effect(() => ctx.tools.register(defineTool(createQunceTool(service))), 'tianshu-qunce: tool');
}

export { TianshuQunceService, QUNCE_TOOL_PARAMETERS, QUNCE_TOOL_OUTPUT };
export { TYPERT } from './typert.host.mjs';
