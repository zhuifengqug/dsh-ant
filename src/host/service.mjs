import path from 'node:path';
import { symbols } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { createTeamActionService } from '../core/actions.mjs';
import { releaseBatch } from '../core/scheduler.mjs';
import { TeamError, invariant } from '../core/errors.mjs';
import { agentContext, creatorContext, ownerContext, remoteContext } from './context.mjs';
import { SessionAdapter } from './session-adapter.mjs';
import { MailDeliveryService } from './mail-delivery.mjs';
import { createSettingsStore } from './settings.mjs';
import { auditEvidence, sealEvidence } from './artifact-audit.mjs';

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

function workBrief({ teamId, member, task, attempt, plan }) {
  const gates = (plan?.qualityGates ?? []).filter(gate => gate.taskId === task.taskId);
  return [
    '【玄驹派工】队 ' + teamId + ' 把「' + task.title + '」(' + task.taskId + ') 派给成员 ' + member.memberId + '。',
    '目标：' + task.objective,
    '范围：' + ((task.inScope ?? []).join('、') || '不限') + '；不做：' + ((task.outOfScope ?? []).join('、') || '无'),
    '验收：' + ((task.acceptance ?? []).join('；') || '按目标'),
    ...(task.verify?.length ? ['验证命令：' + task.verify.join('；')] : []),
    ...(gates.length ? ['质量门：' + gates.map(gate => gate.gateId + '(' + gate.kind + ')').join('、')] : []),
    'attempt：' + attempt.attemptId,
    '回报：用 ant_team_dispatch 发 task.complete，payload { taskId, attemptId, summary, evidence }。',
    ...(task.verify?.length
      ? ['命令类证据的 locator 必须就是上面的验证命令原文，否则完成会被拒。']
      : ['至少给一条证据，locator 指向你改的文件。']),
    '审查不要自己做：交回队里，由没干过这个任务的成员发 quality.review。',
    ...(member.executionPrompt ? [member.executionPrompt] : []),
  ].join('\n');
}

function workspaceRootOf(state, view) {
  return path.resolve(state.config.workspaceRoot, view.workspaceRelativePath ?? '.');
}

/** Completion claims become content digests before the WAL records them. */
async function sealRequest(state, service, input) {
  if (input?.action !== 'task.complete' || !Array.isArray(input.payload?.evidence)) return input;
  const view = await service.get({ teamId: input.teamId });
  const evidence = await sealEvidence({ root: workspaceRootOf(state, view), evidence: input.payload.evidence });
  return { ...input, payload: { ...input.payload, evidence } };
}
async function dispatchThroughService(receiver, input, context, signal) {
  abortIfRequested(signal);
  const service = await receiver.ready();
  abortIfRequested(signal);
  const receipt = await service.dispatch(await sealRequest(stateOf(receiver), service, input), context);
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
    settingsFile: config.settingsFile,
  };
}

/** Host-facing facade over the canonical TeamActionService. */
export class AntService extends TypertRemoteService {
  constructor(ctx, config = {}) {
    super(ctx, 'ant', { namespace: 'team' });
    const normalizedConfig = normalizeConfig(config);
    const state = {
      config: normalizedConfig,
      settings: createSettingsStore({ file: normalizedConfig.settingsFile }),
      closed: false,
      closePromise: undefined,
      sessionAdapter: ctx?.sessionController ? new SessionAdapter(ctx.sessionController) : undefined,
      actionService: undefined,
      mailDelivery: undefined,
      recoveryPromise: undefined,
      hatching: new Map(),
    };
    state.actionService = Promise.resolve().then(() => createTeamActionService({
      workspaceRoot: normalizedConfig.workspaceRoot,
      ownerId: normalizedConfig.ownerId,
      config: { includeArchived: normalizedConfig.includeArchived, readSettings: () => state.settings.read() },
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
  get settingsFile() { return stateOf(this).settings.file; }

  /** The panel's read side: one file, re-read when it changed. */
  async settings(_request = {}, signal) {
    abortIfRequested(signal);
    return stateOf(this).settings.read();
  }

  /** The panel's write side; the next action already sees the new values. */
  async writeSettings(request = {}, signal) {
    abortIfRequested(signal);
    return stateOf(this).settings.write(request?.patch ?? {});
  }

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

  /** A Session with no colony of its own opens one; the caller must seat itself in the roster. */
  async dispatchAsCreator(input, agent, signal) {
    abortIfRequested(signal);
    invariant(agent && typeof agent === 'object', 'team/forbidden', 'Calling agent is required');
    invariant(input?.action === 'team.create', 'team/forbidden', 'Creator dispatch is limited to team creation');
    const context = creatorContext(agent);
    const actionService = await this.ready();
    for (const entry of (await actionService.list({})).teams) {
      let view;
      try { view = await actionService.get({ teamId: entry.teamId }); } catch { continue; }
      const seated = (view.members ?? []).find(candidate => candidate.status === 'active' && candidate.sessionId === context.sessionId);
      invariant(!seated, 'team/forbidden', 'This Session already belongs to a Team');
    }
    return dispatchThroughService(this, input, context, signal);
  }

  /** Resolve the calling Session to its active membership; every member surface goes through here. */
  async resolveMember(agent, teamId, signal) {
    abortIfRequested(signal);
    invariant(agent && typeof agent === 'object', 'team/forbidden', 'Calling agent is required');
    invariant(typeof teamId === 'string' && teamId.length > 0, 'team/forbidden', 'Agent dispatch requires a teamId');
    const sessionId = sessionIdOf(agent);
    invariant(typeof sessionId === 'string' && sessionId.length > 0, 'team/forbidden', 'Calling agent session is required');
    const actionService = await this.ready();
    const view = await actionService.get({ teamId });
    abortIfRequested(signal);
    const member = view.members.find(candidate => candidate.status === 'active' && candidate.sessionId === sessionId);
    invariant(member, 'team/forbidden', 'Calling agent is not an active Team member');
    return { actionService, view, member, sessionId };
  }

  async dispatchAsAgent(input, agent, signal) {
    const { member, sessionId } = await this.resolveMember(agent, input?.teamId, signal);
    return dispatchThroughService(this, input, agentContext(agent, { teamId: input.teamId, memberId: member.memberId }), signal);
  }

  /** Batch release stays owner-authorised in the WAL; membership is what the tool boundary checks. */
  async releaseAsAgent(input, agent, signal) {
    const { member, view } = await this.resolveMember(agent, input?.teamId, signal);
    invariant(view.leadMemberId && view.leadMemberId === member.memberId, 'team/forbidden', 'Release is reserved to the colony lead', { retryable: false, teamId: input.teamId, memberId: member.memberId });
    return releaseBatch({ service: this, teamId: input.teamId, taskIds: input.taskIds ?? [], settings: stateOf(this).settings.read() });
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

  /**
   * A colony that declares ephemeral members has to hatch their Sessions: the roster records
   * intent, the Host owns Session creation, and the binding lands in the WAL as member.hatched.
   * One hatch per team runs at a time, and a failed hatch leaves the member unhatched for retry.
   */
  /** A run the Session layer could not finish: the attempt stops so the lead can retry or reassign it. */
  async interruptRun({ teamId, taskId, attemptId, kind = 'output-limit', reason = 'Run stopped before it finished' } = {}, signal) {
    abortIfRequested(signal);
    return dispatchThroughService(this, {
      requestId: 'interrupt-' + (attemptId ?? taskId ?? teamId),
      teamId,
      action: 'run.interrupted',
      payload: { reason, kind, ...(taskId ? { taskId } : {}), ...(attemptId ? { attemptId } : {}) },
    }, { actor: 'system', teamId }, signal);
  }
  /** Recompute every recorded file digest; drift is visible even when size and mtime are not. */
  async auditArtifacts({ teamId }) {
    const service = await this.ready();
    const view = await service.get({ teamId });
    const root = workspaceRootOf(stateOf(this), view);
    const entries = (view.attempts ?? []).flatMap(item =>
      (item.completion?.evidence ?? []).map(entry => ({ ...entry, taskId: item.taskId, attemptId: item.attemptId })));
    return { teamId, root, ...(await auditEvidence({ root, entries })) };
  }
  async hatchMembers({ teamId }) {
    const state = stateOf(this);
    const adapter = state.sessionAdapter;
    if (!adapter) return [];
    const pendingRun = state.hatching.get(teamId);
    if (pendingRun) return pendingRun;
    const run = (async () => {
      const service = await this.ready();
      const view = await service.get({ teamId });
      const waiting = view.planConfirmed
        ? view.members.filter(member => member.origin === 'team-created' && !member.sessionId
          && member.status !== 'removed' && member.sessionMode === 'ephemeral')
        : [];
      if (!waiting.length) return [];
      const cwd = path.resolve(this.workspaceRoot, view.workspaceRelativePath ?? '.');
      const hatched = [];
      for (const member of waiting) {
        try {
          const created = await adapter.create({ cwd });
          const sessionId = created?.sessionId ?? created?.session?.id ?? created?.agent?.session?.id;
          invariant(typeof sessionId === 'string' && sessionId.length > 0, 'team/unavailable', 'Session creation returned no Session', { teamId, memberId: member.memberId, retryable: true });
          try {
            await adapter.selectModel({ sessionId, provider: member.provider, model: member.model, ...(member.reasoningEffort ? { reasoningEffort: member.reasoningEffort } : {}) });
          } catch { /* the hatched Session runs on its default model */ }
          await service.dispatch({ requestId: 'hatch-' + teamId + '-' + member.memberId, teamId, action: 'member.hatch', payload: { memberId: member.memberId, sessionId } }, { actor: 'system', teamId });
          hatched.push({ memberId: member.memberId, sessionId });
        } catch (error) {
          hatched.push({ memberId: member.memberId, error: error?.message });
        }
      }
      return hatched;
    })().finally(() => state.hatching.delete(teamId));
    state.hatching.set(teamId, run);
    return run;
  }

  /**
   * The WAL records the dispatch; waking the Session that must do the work is the Host's job.
   * A refused prompt pauses the attempt so the next tick can resume and retry it.
   */
  async deliverWork({ teamId, assignments = [] }) {
    const adapter = stateOf(this).sessionAdapter;
    if (!adapter || !assignments.length) return [];
    const service = await this.ready();
    const view = await service.get({ teamId });
    const delivered = [];
    for (const item of assignments) {
      const attempt = view.attempts.find(candidate => candidate.attemptId === item.attemptId)
        ?? view.attempts.filter(candidate => candidate.taskId === item.taskId && candidate.memberId === item.memberId).at(-1);
      const task = view.tasks.find(candidate => candidate.taskId === item.taskId);
      const member = view.members.find(candidate => candidate.memberId === item.memberId);
      if (!attempt || !task || !member?.sessionId) continue;
      delivered.push(await this.#deliverAttempt({ adapter, service, teamId, view, task, member, attempt }));
    }
    return delivered;
  }

  async #deliverAttempt({ adapter, service, teamId, view, task, member, attempt }) {
    const request = {
      requestId: 'work-' + teamId + '-' + attempt.attemptId,
      sessionId: member.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: workBrief({ teamId, member, task, attempt, plan: view.plan }) }],
    };
    try {
      await adapter.prompt(request);
      return { taskId: task.taskId, attemptId: attempt.attemptId, memberId: member.memberId, delivered: true };
    } catch (error) {
      await service.dispatch({ requestId: 'stall-' + teamId + '-' + attempt.attemptId, teamId, action: 'attempt.pause', payload: { taskId: task.taskId, attemptId: attempt.attemptId } }, { actor: 'system', teamId }).catch(() => undefined);
      return { taskId: task.taskId, attemptId: attempt.attemptId, memberId: member.memberId, delivered: false, reason: error?.message };
    }
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
