import { TeamError, invariant } from '../core/errors.mjs';

export class SessionAdapter {
  #controller;
  constructor(controller) {
    this.#controller = controller;
  }

  async resolve(sessionId) {
    invariant(typeof sessionId === 'string' && sessionId.length > 0, 'team/invalid-action', 'sessionId is required');
    invariant(this.#controller && typeof this.#controller.resolveAgent === 'function', 'team/unavailable', 'Session controller is unavailable');
    const result = await this.#controller.resolveAgent(sessionId);
    if (result?.error) throw result.error;
    const agent = result?.agent ?? result;
    if (!agent) throw new TeamError('team/session-not-found', 'Session agent is unavailable', { sessionId, retryable: false });
    return agent;
  }

  async prompt(request, signal) {
    invariant(this.#controller && typeof this.#controller.prompt === 'function', 'team/unavailable', 'Session controller is unavailable');
    return this.#controller.prompt(request, signal);
  }

  async selectModel(request, signal) {
    invariant(this.#controller && typeof this.#controller.selectModel === 'function', 'team/unavailable', 'Session controller is unavailable');
    return this.#controller.selectModel(request, signal);
  }
}
