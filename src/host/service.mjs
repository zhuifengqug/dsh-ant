import { symbols } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { createTeamActionService } from '../core/actions.mjs';
import { TeamError, invariant } from '../core/errors.mjs';
import { agentContext, ownerContext, remoteContext } from './context.mjs';
import { SessionAdapter } from './session-adapter.mjs';
import { MailDeliveryService } from './mail-delivery.mjs';

const DEFAULT_OWNER_ID = 'ant-host';
const serviceStates = new WeakMap();

function stateOf(receiver) {
  const original = receiver?.[symbols.original] ?? receiver;
  const state = serviceStates.get(original);
  invariant(state, 'team/unavailable', 'Amber Ant service state is unavailable');
  return state;
}

function sessionIdOf(agent) {
  return agent?.session?.id ?? agent?.session?.header?.id ?? agent?.id;
}

function abortIfRequested(signal) {
  if (signal?.aborted) {
    throw new TeamError('team/cancelled', 'Team action was cancelled', { retryable: true });
  }
}

function isActionContext(value) {
  return value && typeof value === 'object' && typeof value.actor === 'string';
}

async function dispatchThroughService(receiver, input, context, signal) {
  abortIfRequested(signal);
  const service = await receiver.ready();
  abortIfRequested(signal);
  const receipt = await service.dispatch(input, context);
  if (input?.action === 'mail.send') {
    const view = await service.get({ teamId: receipt.teamId });
    const mail = view.mailbox.find(item => item.messageId === input.payload?.messageId);
    const delivery = stateOf(receiver).mailDelivery;
    if (mail?.state === 'queued' && delivery) void delivery.schedule(receipt.teamId, mail);
  }
  return receipt;
}

function normalizeConfig(config = {}) {
  return {
    workspaceRoot: config.workspaceRoot ?? process.cwd(),
    ownerId: config.ownerId ?? DEFAULT_OWNER_ID,
    includeArchived: config.includeArchived ?? false,
  };
}

/** Host-facing facade over the canonical TeamActionService. */
export class AntService extends TypertRemoteService {
  constructor(ctx, config = {}) {
    super(ctx, 'ant', { namespace: 'team' });
    const normalizedConfig = normalizeConfig(config);
    const state = {
      config: normalizedConfig,
      closed: false,
      closePromise: undefined,
      sessionAdapter: ctx?.sessionController ? new SessionAdapter(ctx.sessionController) : undefined,
      actionService: undefined,
      mailDelivery: undefined,
      recoveryPromise: undefined,
    };
    state.actionService = Promise.resolve().then(() => createTeamActionService({
      workspaceRoot: normalizedConfig.workspaceRoot,
      ownerId: normalizedConfig.ownerId,
      config: { includeArchived: normalizedConfig.includeArchived },
    })).then(service => {
      if (state.closed || !state.sessionAdapter) {
        state.recoveryPromise = Promise.resolve();
        return service;
      }
      state.mailDelivery = new MailDeliveryService({ actionService: service, sessionAdapter: state.sessionAdapter });
      state.recoveryPromise = state.mailDelivery.recover();
      state.recoveryPromise.catch(() => undefined);
      return service;
    });
    // Observe initialization failures without hiding them from ready().
    state.actionService.catch(() => undefined);
    serviceStates.set(this[symbols.original] ?? this, state);
  }

  get workspaceRoot() { return stateOf(this).config.workspaceRoot; }
  get config() { return { ...stateOf(this).config }; }
  get sessionAdapter() { return stateOf(this).sessionAdapter; }

  async ready() {
    const state = stateOf(this);
    invariant(!state.closed, 'team/lease-lost', 'Amber Ant service is closed');
    const service = await state.actionService;
    await state.recoveryPromise;
    invariant(!state.closed, 'team/lease-lost', 'Amber Ant service is closed');
    return service;
  }

  async dispatch(input, contextOrSignal) {
    const signal = isActionContext(contextOrSignal) ? undefined : contextOrSignal;
    const context = isActionContext(contextOrSignal)
      ? contextOrSignal
      : remoteContext(this.ctx?.invocation);
    return dispatchThroughService(this, input, context, signal);
  }

  async dispatchAsOwner(input, signal) {
    return dispatchThroughService(this, input, ownerContext(), signal);
  }

  async dispatchFromRemote(input, invocation, signal) {
    return dispatchThroughService(this, input, remoteContext(invocation), signal);
  }

  async dispatchAsAgent(input, agent, signal) {
    abortIfRequested(signal);
    invariant(agent && typeof agent === 'object', 'team/forbidden', 'Calling agent is required');
    const teamId = input?.teamId;
    invariant(typeof teamId === 'string' && teamId.length > 0, 'team/forbidden', 'Agent dispatch requires a teamId');
    const sessionId = sessionIdOf(agent);
    invariant(typeof sessionId === 'string' && sessionId.length > 0, 'team/forbidden', 'Calling agent session is required');
    const actionService = await this.ready();
    const view = await actionService.get({ teamId });
    abortIfRequested(signal);
    const member = view.members.find(candidate => candidate.status === 'active' && candidate.sessionId === sessionId);
    invariant(member, 'team/forbidden', 'Calling agent is not an active Team member');
    return dispatchThroughService(this, input, agentContext(agent, { teamId, memberId: member.memberId }), signal);
  }

  async get(input, signal) {
    abortIfRequested(signal);
    const service = await this.ready();
    abortIfRequested(signal);
    return service.get(input);
  }

  async list(input = {}, signal) {
    abortIfRequested(signal);
    const service = await this.ready();
    abortIfRequested(signal);
    return service.list(input);
  }

  async resolveSession(sessionId, signal) {
    abortIfRequested(signal);
    const adapter = stateOf(this).sessionAdapter;
    invariant(adapter, 'team/unavailable', 'Session controller is unavailable');
    return adapter.resolve(sessionId, signal);
  }

  async createSession(request) {
    const adapter = stateOf(this).sessionAdapter;
    invariant(adapter, 'team/unavailable', 'Session controller is unavailable');
    return adapter.create(request);
  }

  async prompt(request, signal) {
    const adapter = stateOf(this).sessionAdapter;
    invariant(adapter, 'team/unavailable', 'Session controller is unavailable');
    return adapter.prompt(request, signal);
  }

  async cancelSession(request) {
    const adapter = stateOf(this).sessionAdapter;
    invariant(adapter, 'team/unavailable', 'Session controller is unavailable');
    return adapter.cancel(request);
  }

  async selectModel(request, signal) {
    const adapter = stateOf(this).sessionAdapter;
    invariant(adapter, 'team/unavailable', 'Session controller is unavailable');
    return adapter.selectModel(request, signal);
  }

  async close() {
    const state = stateOf(this);
    if (state.closePromise) return state.closePromise;
    state.closed = true;
    state.closePromise = Promise.resolve(state.mailDelivery?.close())
      .catch(() => undefined)
      .then(() => state.actionService.then(service => service.close(), () => undefined));
    state.closePromise.catch(() => undefined);
    return state.closePromise;
  }
}
