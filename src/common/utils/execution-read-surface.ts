export interface ExecutionSurfaceInput {
  waitingOnImport?: number | null;
  waitingOnMessageGeneration?: number | null;
  queuedForSend?: number | null;
  waitingOnMailbox?: number | boolean | null;
  blockedAtConsent?: number | null;
  blockedAtSuppression?: number | null;
  sent?: number | null;
  failed?: number | null;
  replies?: number | null;
  meetings?: number | null;
  bootstrapStatus?: string | null;
  workflowStatus?: string | null;
  mailboxReady?: boolean | null;
}

function count(value: number | boolean | null | undefined): number {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return Number.isFinite(value as number) ? Number(value) : 0;
}

function hasBootstrapActivity(value: string | null | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized.length > 0 && normalized !== 'activation_completed' && normalized !== 'ready';
}

export function deriveExecutionStage(input: ExecutionSurfaceInput): string {
  const meetings = count(input.meetings);
  const replies = count(input.replies);
  const failed = count(input.failed);
  const queuedForSend = count(input.queuedForSend);
  const waitingOnMailbox = count(input.waitingOnMailbox);
  const waitingOnMessageGeneration = count(input.waitingOnMessageGeneration);
  const waitingOnImport = count(input.waitingOnImport);
  const blockedAtConsent = count(input.blockedAtConsent);
  const blockedAtSuppression = count(input.blockedAtSuppression);
  const sent = count(input.sent);

  if (meetings > 0) return 'MEETING_HANDOFF';
  if (replies > 0) return 'REPLIED';
  if (failed > 0 && sent === 0 && queuedForSend === 0) return 'FAILED';
  if (waitingOnImport > 0 || hasBootstrapActivity(input.bootstrapStatus)) return 'WAITING_ON_IMPORT';
  if (waitingOnMessageGeneration > 0) return 'WAITING_ON_MESSAGE_GENERATION';
  if (waitingOnMailbox > 0 || input.mailboxReady === false) return 'WAITING_ON_MAILBOX';
  if (blockedAtConsent > 0 || blockedAtSuppression > 0) return 'BLOCKED';
  if (queuedForSend > 0) return 'QUEUED_FOR_SEND';
  if (sent > 0) return 'SENT';
  return 'IDLE';
}

export function buildExecutionReadSurface(input: ExecutionSurfaceInput) {
  const counts = {
    waitingOnImport: count(input.waitingOnImport),
    waitingOnMessageGeneration: count(input.waitingOnMessageGeneration),
    queuedForSend: count(input.queuedForSend),
    waitingOnMailbox: count(input.waitingOnMailbox),
    blockedAtConsent: count(input.blockedAtConsent),
    blockedAtSuppression: count(input.blockedAtSuppression),
    sent: count(input.sent),
    failed: count(input.failed),
    replies: count(input.replies),
    meetings: count(input.meetings),
  };

  const stage = deriveExecutionStage(input);
  const labels: Record<string, string> = {
    WAITING_ON_IMPORT: 'Waiting on import',
    WAITING_ON_MESSAGE_GENERATION: 'Waiting on message generation',
    WAITING_ON_MAILBOX: 'Waiting on mailbox',
    BLOCKED: 'Blocked',
    QUEUED_FOR_SEND: 'Queued for send',
    SENT: 'Sending active',
    REPLIED: 'Replies received',
    MEETING_HANDOFF: 'Meetings in motion',
    FAILED: 'Needs attention',
    IDLE: 'Idle',
  };
  const summaryMap: Record<string, string> = {
    WAITING_ON_IMPORT: 'Contacts and lead inventory are still being prepared.',
    WAITING_ON_MESSAGE_GENERATION: 'Qualified records are waiting for message preparation.',
    WAITING_ON_MAILBOX: 'Execution is paused behind mailbox readiness or mailbox assignment.',
    BLOCKED: 'Communication is being held by permission or suppression controls.',
    QUEUED_FOR_SEND: 'Messages are prepared and waiting for dispatch execution.',
    SENT: 'Outbound activity has started and is flowing through send execution.',
    REPLIED: 'Replies are in the system and need classification or follow-through.',
    MEETING_HANDOFF: 'The system has reached meeting-stage outcomes.',
    FAILED: 'One or more execution paths have failed and need review.',
    IDLE: 'There is no active execution pressure right now.',
  };

  const blockers: string[] = [];
  if (counts.waitingOnMailbox > 0 || input.mailboxReady === false) blockers.push('mailbox');
  if (counts.waitingOnImport > 0) blockers.push('import');
  if (counts.waitingOnMessageGeneration > 0) blockers.push('message_generation');
  if (counts.blockedAtConsent > 0) blockers.push('consent');
  if (counts.blockedAtSuppression > 0) blockers.push('suppression');
  if (counts.failed > 0) blockers.push('failed_jobs_or_messages');

  return {
    stage,
    label: labels[stage] ?? 'Execution state',
    summary: summaryMap[stage] ?? 'Execution truth available.',
    counts,
    blockers,
    readiness: {
      mailboxReady: input.mailboxReady !== false,
      canAdvance:
        stage !== 'WAITING_ON_MAILBOX' &&
        stage !== 'BLOCKED' &&
        stage !== 'FAILED',
    },
    bootstrapStatus: input.bootstrapStatus ?? null,
    workflowStatus: input.workflowStatus ?? null,
  };
}
