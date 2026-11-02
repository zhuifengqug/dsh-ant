import { stableMailRequestId } from '../core/canonical.mjs';
import { TeamError, invariant } from '../core/errors.mjs';

const MAX_RETRY_MS = 30_000;

function retryable(error) {
  if (error instanceof TeamError) return error.details?.retryable === true;
  if (typeof error?.details?.retryable === 'boolean') return error.details.retryable;
  if (typeof error?.retryable === 'boolean') return error.retryable;
  return true;
}

/** Host-owned delivery loop; durable intent and admission remain Team WAL facts. */
export class MailDeliveryService {
  #actions;
  #sessions;
  #closed = false;
  #running = new Map();
  #retryTimers = new Set();
  #retryCounts = new Map();
  #abortController = new AbortController();

  constructor({ actionService, sessionAdapter }) {
    this.#actions = actionService;
    this.#sessions = sessionAdapter;
  }

  async recover() {
    if (this.#closed) return;
    const pending = await this.#actions.pendingMail();
    for (const item of pending) this.schedule(item.teamId, item.mail);
  }

  schedule(teamId, mail) {
    const key = `${teamId}:${mail?.messageId}`;
    if (this.#closed || !mail || this.#running.has(key)) return;
    const operation = this.#deliver(teamId, mail).catch(error => {
      if (this.#closed || !retryable(error)) return;
      const count = (this.#retryCounts.get(key) ?? 0) + 1;
      this.#retryCounts.set(key, count);
      const delay = Math.min(250 * (2 ** Math.min(count - 1, 7)), MAX_RETRY_MS);
      const timer = setTimeout(() => {
        this.#retryTimers.delete(timer);
        if (!this.#closed) this.schedule(teamId, mail);
      }, delay);
      timer.unref?.();
      this.#retryTimers.add(timer);
    }).finally(() => this.#running.delete(key));
    this.#running.set(key, operation);
    return operation;
  }

  async drain() {
    while (this.#running.size) await Promise.allSettled([...this.#running.values()]);
  }

  async #deliver(teamId, mail) {
    const view = await this.#actions.get({ teamId });
    const current = view.mailbox.find(item => item.messageId === mail.messageId);
    invariant(current?.state === 'queued', 'team/unavailable', 'Mailbox message is no longer queued', { retryable: false, teamId, messageId: mail.messageId });
    invariant(current.toSessionId === mail.toSessionId && current.deliveryMode === mail.deliveryMode, 'team/forbidden', 'Mailbox recipient binding changed', { retryable: false, teamId, messageId: mail.messageId });
    const member = view.members.find(item => item.memberId === current.toMemberId);
    invariant(member?.status === 'active' && member.sessionId === current.toSessionId, 'team/forbidden', 'Mailbox recipient Session is no longer active', { retryable: false, teamId, messageId: mail.messageId });
    invariant(typeof current.toSessionId === 'string' && current.toSessionId.length > 0, 'team/invalid-state', 'Queued mail has no stable recipient Session');
    const request = {
      requestId: stableMailRequestId(teamId, mail.messageId),
      sessionId: mail.toSessionId,
      mode: mail.deliveryMode,
      content: [{ type: 'text', text: mail.content }],
    };
    const result = await this.#sessions.prompt(request, this.#abortController.signal);
    if (this.#closed) return;
    await this.#actions.admitMail({
      teamId,
      messageId: mail.messageId,
      sessionId: mail.toSessionId,
      deliveryMode: mail.deliveryMode,
      accepted: result.accepted,
    });
    this.#retryCounts.delete(`${teamId}:${mail.messageId}`);
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#abortController.abort();
    for (const timer of this.#retryTimers) clearTimeout(timer);
    this.#retryTimers.clear();
    await this.drain();
  }
}
