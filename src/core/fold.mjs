import { invariant } from './errors.mjs';
import { digest } from './canonical.mjs';

/** Pure TeamView fold. Unknown event types block reconstruction instead of being ignored. */
export function foldTeam(events) {
  let view;
  const find = (items, key, id) => {
    const item = items.find(value => value[key] === id);
    invariant(item, 'team/rebuild-required', `Missing ${key} ${id}`);
    return item;
  };
  for (const event of events) {
    const payload = structuredClone(event.payload);
    if (event.type === 'team.created') {
      invariant(!view, 'team/rebuild-required', 'Duplicate team creation');
      view = {
        schemaVersion: 1, teamId: event.teamId, goal: payload.goal, workspaceRelativePath: payload.workspaceRelativePath,
        lifecycle: payload.plan.mode === 'fast' ? 'planned' : 'staged', plan: payload.plan, planDigest: digest(payload.plan),
        planConfirmed: payload.plan.mode === 'fast', members: payload.members.map(member => ({ ...member, origin: member.sessionId ? 'existing' : 'team-created', status: member.sessionId ? 'active' : 'requested' })),
        tasks: payload.plan.tasks.map(task => ({ ...task, state: 'pending' })), attempts: [], invitations: [], mailbox: [], cursor: 0,
      };
    } else {
      invariant(view, 'team/rebuild-required', 'Team creation must be first');
      const attempt = () => find(view.attempts, 'attemptId', event.attemptId ?? payload.attemptId);
      const task = () => find(view.tasks, 'taskId', payload.taskId ?? attempt().taskId);
      switch (event.type) {
        case 'plan.confirmed': view.planConfirmed = true; view.lifecycle = 'planned'; break;
        case 'attempt.dispatched':
          view.attempts.push({ ...payload, state: 'running' }); task().state = 'running'; view.lifecycle = 'running'; break;
        case 'attempt.pause-requested':
        case 'attempt.paused': attempt().state = 'paused'; task().state = 'paused'; break;
        case 'attempt.resume-requested':
        case 'attempt.resumed': attempt().state = 'running'; task().state = 'running'; break;
        case 'attempt.takeover-requested':
        case 'attempt.taken-over': attempt().state = 'taken-over'; task().state = 'taken-over'; break;
        case 'attempt.terminate-requested':
        case 'attempt.terminated': attempt().state = 'terminated'; task().state = 'terminated'; break;
        case 'member.invited': view.invitations.push({ ...payload, state: 'requested' }); break;
        case 'member.accept-requested':
        case 'member.accepted': {
          const invitation = find(view.invitations, 'invitationId', payload.invitationId);
          invitation.state = 'accepted';
          if (payload.member) view.members.push({ ...payload.member, origin: 'existing', status: 'active' });
          break;
        }
        case 'member.removed': find(view.members, 'memberId', payload.memberId).status = 'removed'; break;
        case 'member.model-change-requested':
        case 'member.model-selected': Object.assign(find(view.members, 'memberId', payload.memberId), payload.selection ?? { provider: payload.provider, model: payload.model, reasoningEffort: payload.reasoningEffort }); break;
        case 'mail.queued':
        case 'mail.admitted': view.mailbox.push({ ...payload, state: event.type === 'mail.admitted' ? 'admitted' : 'queued', receipts: [] }); break;
        case 'mail.read': {
          const mail = find(view.mailbox, 'messageId', payload.messageId);
          invariant(['admitted', 'delivered', 'queued'].includes(mail.state), 'team/rebuild-required', 'Mailbox read receipt is out of order');
          mail.state = 'read'; mail.receipts.push({ stage: 'read', eventSeq: event.eventSeq }); break;
        }
        case 'mail.consumed': {
          const mail = find(view.mailbox, 'messageId', payload.messageId);
          mail.state = 'consumed'; mail.receipts.push({ stage: 'consumed', eventSeq: event.eventSeq }); break;
        }
        case 'quality.reported':
          Object.assign(attempt(), { state: payload.verdict === 'pass' ? 'completed' : 'failed', quality: payload });
          task().state = payload.verdict === 'pass' ? 'completed' : 'failed';
          if (view.tasks.every(item => item.state === 'completed')) view.lifecycle = 'completed'; break;
        case 'team.archiving': view.lifecycle = 'archiving'; break;
        case 'team.drain-complete': view.lifecycle = 'drain-complete'; break;
        case 'team.archived': view.lifecycle = 'archived'; break;
        case 'team.restored': view.lifecycle = payload.previousLifecycle; break;
        case 'team.delete-requested': view.lifecycle = 'deleting'; view.cleanupIntent = payload; break;
        default: invariant(false, 'team/rebuild-required', `Unknown team event ${event.type}`);
      }
    }
    invariant(event.teamId === view.teamId && event.eventSeq === view.cursor + 1, 'team/rebuild-required', 'Fold cursor mismatch');
    view.cursor = event.eventSeq;
  }
  return view;
}
