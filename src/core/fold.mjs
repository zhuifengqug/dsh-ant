import { invariant } from './errors.mjs';
import { digest, teamFingerprint } from './canonical.mjs';

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
        schemaVersion: 1, teamId: event.teamId, goal: payload.goal, workspaceRelativePath: payload.workspaceRelativePath, fingerprint: teamFingerprint(payload),
        lifecycle: payload.plan.mode === 'fast' ? 'planned' : 'staged', plan: payload.plan, planDigest: digest(payload.plan),
        planState: payload.plan.mode === 'fast' ? 'confirmed' : 'staged', planConfirmed: payload.plan.mode === 'fast', halted: false, ...(payload.leadMemberId ? { leadMemberId: payload.leadMemberId } : {}), members: payload.members.map(member => ({ ...member, origin: member.sessionId ? 'existing' : 'team-created', status: member.sessionId ? 'active' : 'requested' })),
        tasks: payload.plan.tasks.map(task => ({ ...task, state: 'pending' })), attempts: [], invitations: [], mailbox: [], claims: [], batches: [], reviews: [], spend: [], interruptions: [], planRevisions: [], taskRevisions: [], cursor: 0,
      };
    } else {
      invariant(view, 'team/rebuild-required', 'Team creation must be first');
      const attempt = () => find(view.attempts, 'attemptId', event.attemptId ?? payload.attemptId);
      const task = () => find(view.tasks, 'taskId', payload.taskId ?? attempt().taskId);
      switch (event.type) {
        case 'plan.confirmed': view.planConfirmed = true; view.planState = 'confirmed'; view.lifecycle = 'planned'; break;
        case 'plan.amended': {
          view.plan = payload.plan;
          view.planDigest = digest(payload.plan);
          view.planState = view.planConfirmed ? 'amended' : 'staged';
          view.planRevisions.push({ revision: payload.revision, reason: payload.reason, previousDigest: payload.previousDigest, digest: view.planDigest, eventSeq: event.eventSeq, occurredAt: event.occurredAt });
          for (const item of view.tasks) {
            const defined = payload.plan.tasks.find(value => value.taskId === item.taskId);
            if (defined) Object.assign(item, defined);
            else if (!['released', 'reviewed'].includes(item.state)) item.state = 'dropped';
          }
          for (const defined of payload.plan.tasks) {
            if (!view.tasks.some(item => item.taskId === defined.taskId)) view.tasks.push({ ...defined, state: 'pending' });
          }
          break;
        }
        case 'task.created': {
          view.tasks.push({ ...payload.task, state: 'pending' });
          view.plan = {
            ...view.plan,
            tasks: [...view.plan.tasks, payload.task],
            dependencies: [...view.plan.dependencies, ...(payload.dependencies ?? [])],
            qualityGates: [...view.plan.qualityGates, ...(payload.qualityGates ?? [])],
          };
          view.planDigest = digest(view.plan);
          view.taskRevisions.push({ taskId: payload.task.taskId, revision: payload.revision, change: 'create', reason: payload.reason ?? null, eventSeq: event.eventSeq });
          break;
        }
        case 'task.amended': {
          const amended = task();
          Object.assign(amended, payload.patch);
          const defined = view.plan.tasks.find(item => item.taskId === payload.taskId);
          if (defined) Object.assign(defined, payload.patch);
          if (payload.reset === true) {
            amended.selfCompleted = false;
            delete amended.repairRounds;
            if (amended.state !== 'released') amended.state = 'pending';
            const stale = [...view.attempts].reverse().find(item => item.taskId === payload.taskId);
            if (stale && ['queued', 'running', 'paused', 'reviewed'].includes(stale.state)) stale.state = 'superseded';
          }
          view.planDigest = digest(view.plan);
          view.taskRevisions.push({ taskId: payload.taskId, revision: payload.revision, change: 'amend', reason: payload.reason, eventSeq: event.eventSeq });
          break;
        }
        case 'task.reassigned': {
          task().ownerMemberId = payload.memberId;
          const defined = view.plan.tasks.find(item => item.taskId === payload.taskId);
          if (defined) defined.ownerMemberId = payload.memberId;
          view.planDigest = digest(view.plan);
          view.taskRevisions.push({ taskId: payload.taskId, revision: payload.revision, change: 'reassign', reason: payload.reason ?? null, eventSeq: event.eventSeq });
          break;
        }
        case 'team.halted': view.halted = true; view.haltReason = payload.reason ?? null; break;
        case 'team.resumed': view.halted = false; view.haltReason = null; break;
        case 'attempt.dispatched':
          view.attempts.push({ ...payload, state: 'running' }); task().state = 'running'; view.lifecycle = 'running'; break;
        case 'attempt.pause-requested':
        case 'attempt.paused': attempt().state = 'paused'; task().state = 'paused'; break;
        case 'attempt.resume-requested':
        case 'attempt.resumed': attempt().state = 'running'; task().state = 'running'; break;
        case 'attempt.takeover-requested':
        case 'attempt.taken-over': attempt().state = 'taken-over'; task().state = 'taken-over'; break;
        case 'attempt.terminate-requested':
        case 'attempt.terminated': {
          attempt().state = 'terminated';
          const aborted = task();
          if (!['reviewed', 'released', 'completed'].includes(aborted.state)) aborted.state = 'terminated';
          break;
        }
        case 'member.hatched': {
          const target = find(view.members, 'memberId', payload.memberId);
          target.sessionId = payload.sessionId; target.status = 'active';
          break;
        }
        case 'member.invited': view.invitations.push({ ...payload, state: 'requested' }); break;
        case 'member.accept-requested':
        case 'member.accepted': {
          const invitation = find(view.invitations, 'invitationId', payload.invitationId);
          invitation.state = 'accepted';
          if (payload.member) {
            const known = view.members.find(item => item.memberId === payload.member.memberId);
            const origin = known?.origin ?? payload.member.origin ?? (payload.member.sessionId ? 'existing' : 'team-created');
            const merged = { ...payload.member, origin, status: 'active', ...(invitation.depth && !payload.member.depth ? { depth: invitation.depth } : {}) };
            if (known) Object.assign(known, merged); else view.members.push(merged);
          }
          break;
        }
        case 'member.removed': find(view.members, 'memberId', payload.memberId).status = 'removed'; break;
        case 'member.model-change-requested':
        case 'member.model-selected': Object.assign(find(view.members, 'memberId', payload.memberId), payload.selection ?? { provider: payload.provider, model: payload.model, reasoningEffort: payload.reasoningEffort }); break;
        case 'mail.queued': {
          invariant(!view.mailbox.some(item => item.messageId === payload.messageId), 'team/rebuild-required', 'Duplicate mailbox identity');
          const recipient = view.members.find(item => item.memberId === payload.toMemberId);
          view.mailbox.push({ ...payload, toSessionId: payload.toSessionId ?? recipient?.sessionId, state: 'queued', receipts: [] }); break;
        }
        case 'mail.admitted': {
          const mail = find(view.mailbox, 'messageId', payload.messageId);
          invariant(mail.state === 'queued', 'team/rebuild-required', 'Mailbox admission is out of order');
          invariant(payload.sessionId === mail.toSessionId && payload.deliveryMode === mail.deliveryMode && payload.accepted === true, 'team/rebuild-required', 'Mailbox admission does not match queued delivery');
          mail.state = 'admitted'; mail.receipts.push({ stage: 'admitted', eventSeq: event.eventSeq, sessionId: payload.sessionId, deliveryMode: payload.deliveryMode }); break;
        }
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
        case 'task.claimed': {
          const claimed = task();
          claimed.state = 'claimed'; claimed.claimMemberId = payload.memberId;
          view.claims.push({ taskId: payload.taskId, memberId: payload.memberId, eventSeq: event.eventSeq });
          break;
        }
        case 'task.completed':
          attempt().completion = payload;
          task().selfCompleted = true; break;
        case 'quality.reviewed': {
          Object.assign(attempt(), { state: payload.verdict === 'pass' ? 'reviewed' : 'failed', review: payload });
          view.reviews.push({ ...payload, eventSeq: event.eventSeq, occurredAt: Date.parse(event.occurredAt) });
          const reviewed = task();
          if (payload.verdict === 'fail') {
            reviewed.repairRounds = (reviewed.repairRounds ?? 0) + 1;
            reviewed.state = reviewed.repairRounds >= 2 ? 'anomalous' : 'failed';
          } else if (reviewed.selfCompleted) reviewed.state = 'reviewed';
          break;
        }
        case 'batch.released': {
          view.batches.push({ ...payload, state: 'released', eventSeq: event.eventSeq });
          for (const releasedId of payload.taskIds) { const released = view.tasks.find(item => item.taskId === releasedId); if (released) released.state = 'released'; }
          break;
        }
        case 'attempt.selected':
          attempt().selectedVariant = payload.variant; task().selectedAttemptId = payload.attemptId; break;
        case 'run.interrupted':
          view.interruptions.push({ ...payload, eventSeq: event.eventSeq }); view.lifecycle = 'interrupted'; break;
        case 'spend.recorded': {
          const entry = { ...payload, eventSeq: event.eventSeq };
          view.spend.push(entry);
          attempt().spend = entry;
          break;
        }
        case 'team.archiving': view.lifecycle = 'archiving'; view.archivePreviousLifecycle = payload.previousLifecycle ?? 'planned'; break;
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
