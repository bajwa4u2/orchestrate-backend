import 'reflect-metadata';
import assert from 'assert';
import {
  ContactEmailStatus,
  MailboxProvider,
  MailboxConnectionState,
  MailboxHealthStatus,
  MailboxRole,
  MailboxStatus,
  WarmupStatus,
} from '@prisma/client';
import { OperatorService } from '../src/operator/operator.service';
import { DeliverabilityService } from '../src/deliverability/deliverability.service';

function buildService() {
  return new OperatorService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  ) as any;
}

function testMailboxDebugSummarySeparatesConnectionStates() {
  const service = buildService();
  const summary = service.buildMailboxDebugSummary([
    {
      status: MailboxStatus.ACTIVE,
      connectionState: MailboxConnectionState.PENDING_AUTH,
      healthStatus: MailboxHealthStatus.HEALTHY,
    },
    {
      status: MailboxStatus.ACTIVE,
      connectionState: MailboxConnectionState.BOOTSTRAPPED,
      healthStatus: MailboxHealthStatus.HEALTHY,
    },
    {
      status: MailboxStatus.ACTIVE,
      connectionState: MailboxConnectionState.REQUIRES_REAUTH,
      healthStatus: MailboxHealthStatus.CRITICAL,
    },
  ]);

  assert.strictEqual(summary.total, 3);
  assert.strictEqual(summary.connected, 1);
  assert.strictEqual(summary.pendingAuth, 1);
  assert.strictEqual(summary.requiresReauth, 1);
  assert.strictEqual(summary.sendCapable, 1);
  assert.strictEqual(summary.needsAttention, 3);
}

function testSuppressionDebugSummaryClassifiesCauses() {
  const service = buildService();
  const summary = service.buildSuppressionDebugSummary({
    suppressedLeads: 51,
    suppressionTypes: [
      { type: 'UNSUBSCRIBE', _count: { _all: 4 } },
      { type: 'HARD_BOUNCE', _count: { _all: 7 } },
      { type: 'COMPLAINT', _count: { _all: 2 } },
      { type: 'MANUAL_BLOCK', _count: { _all: 3 } },
    ],
    outreachBlocked: 9,
    invalidContacts: 5,
    bouncedContacts: 6,
    importDuplicates: 10,
    importInvalid: 8,
  });

  assert.strictEqual(summary.totalSuppressedLeads, 51);
  assert.strictEqual(summary.causes.unsubscribed, 4);
  assert.strictEqual(summary.causes.bounced, 13);
  assert.strictEqual(summary.causes.duplicate, 10);
  assert.strictEqual(summary.causes.invalid, 13);
  assert.strictEqual(summary.causes.consent, 9);
  assert.strictEqual(summary.causes.policy, 5);
}

function testPermissionAndExecutionDebugSummaries() {
  const service = buildService();
  const permissions = service.buildPermissionDebugSummary([
    { communication: 'OUTREACH', status: 'ALLOWED', _count: { _all: 3 } },
    { communication: 'OUTREACH', status: 'BLOCKED', _count: { _all: 2 } },
  ]);
  assert.strictEqual(permissions.total, 5);
  assert.strictEqual(permissions.allowed, 3);
  assert.strictEqual(permissions.blocked, 2);
  assert.strictEqual(permissions.status, 'HAS_BLOCKS');

  const aggregate = service.buildExecutionDebugAggregate('WAITING_ON_IMPORT', {
    waitingOnImport: 1,
    queuedForSend: 16,
    sent: 13,
    blockedAtSuppression: 51,
  });
  assert.strictEqual(aggregate.mixed, true);
  assert.strictEqual(aggregate.displayStage, 'MIXED_ACTIVITY');
  assert.strictEqual(aggregate.signals.length, 4);
}

async function testMailboxReconnectActionPreparesAuthState() {
  let updateInput: any;
  const service = new DeliverabilityService({
    mailbox: {
      findFirst: async () => ({
        id: 'mailbox_a',
        organizationId: 'org_a',
        clientId: null,
        domainId: null,
        label: 'Primary',
        role: MailboxRole.PRIMARY_OUTREACH,
        emailAddress: 'outreach@example.com',
        fromName: 'Orchestrate',
        replyToAddress: 'reply@example.com',
        provider: MailboxProvider.OTHER,
        connectionState: MailboxConnectionState.AUTHORIZED,
        isClientOwned: false,
        status: MailboxStatus.ACTIVE,
        dailySendCap: 100,
        hourlySendCap: 20,
        warmupStatus: WarmupStatus.NOT_STARTED,
        lastSyncedAt: null,
        connectedAt: new Date('2026-04-29T00:00:00Z'),
        disconnectedAt: null,
        lastAuthAt: new Date('2026-04-29T00:00:00Z'),
        healthStatus: MailboxHealthStatus.HEALTHY,
        healthScore: null,
        credentialsJson: null,
        metadataJson: { authUrl: 'https://mail.example.com/oauth' },
        createdAt: new Date('2026-04-29T00:00:00Z'),
        updatedAt: new Date('2026-04-29T00:00:00Z'),
      }),
      update: async (input: any) => {
        updateInput = input;
        return {
          id: 'mailbox_a',
          emailAddress: 'outreach@example.com',
          status: input.data.status,
          connectionState: input.data.connectionState,
        };
      },
    },
  } as any);

  const result = await service.prepareMailboxReconnect('mailbox_a', 'org_a');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.connectionState, MailboxConnectionState.PENDING_AUTH);
  assert.strictEqual(updateInput.data.status, MailboxStatus.CONNECTING);
  assert(updateInput.data.metadataJson.reconnect.authUrl.includes('mailboxId=mailbox_a'));
}

async function main() {
  assert.strictEqual(ContactEmailStatus.INVALID, 'INVALID');
  testMailboxDebugSummarySeparatesConnectionStates();
  testSuppressionDebugSummaryClassifiesCauses();
  testPermissionAndExecutionDebugSummaries();
  await testMailboxReconnectActionPreparesAuthState();
  console.log('live ops debug tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
