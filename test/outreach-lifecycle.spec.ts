import 'reflect-metadata';
import assert from 'assert';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JobStatus, JobType } from '@prisma/client';
import { ClientCampaignController } from '../src/clients/client-campaign.controller';
import { CampaignsService } from '../src/campaigns/campaigns.service';
import { ClientsService } from '../src/clients/clients.service';
import { ExecutionService } from '../src/execution/execution.service';
import { WorkflowsService } from '../src/workflows/workflows.service';

async function expectRejectsWith(
  action: () => Promise<unknown>,
  errorType: new (...args: any[]) => Error,
) {
  let thrown: unknown;
  try {
    await action();
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof errorType, `Expected ${errorType.name}, got ${String(thrown)}`);
}

async function testUnauthorizedCampaignStartRejected() {
  const controller = new ClientCampaignController(
    {
      startCampaign: async () => {
        throw new Error('start should not run');
      },
    } as any,
    {} as any,
    {
      requireClient: async () => {
        throw new UnauthorizedException('Missing client session');
      },
    } as any,
  );

  await expectRejectsWith(() => controller.startCampaign({}), UnauthorizedException);
}

async function testClientStartScopesCampaignActivation() {
  let activationInput: any;
  const service = new ClientsService({} as any, {} as any, {} as any, {
    activateCampaign: async (input: any) => {
      activationInput = input;
      return { ok: true, status: 'activation_requested', generationState: 'TARGETING_READY' };
    },
  } as any, {} as any) as any;

  service.resolveClientForRequest = async () => ({
    id: 'client_a',
    organizationId: 'org_a',
    metadataJson: { setup: { scope: { countries: [{ code: 'US', label: 'United States' }], industries: [{ code: 'saas', label: 'SaaS' }] } } },
    scopeJson: null,
    selectedPlan: 'opportunity',
    bookingUrl: null,
    primaryTimezone: 'America/New_York',
  });
  service.resolveCommercialState = async () => ({ service: 'opportunity', tier: 'focused' });
  service.buildSubscriptionAlignment = () => ({ tierCovered: true });
  service.ensureRepresentationAuth = async () => null;
  service.buildScopeJson = (input: any) => ({
    version: 2,
    lane: input.lane,
    mode: input.mode ?? 'focused',
    countries: input.countries ?? [{ code: 'US', label: 'United States' }],
    regions: input.regions ?? [],
    metros: input.metros ?? [],
    industries: input.industries ?? [{ code: 'saas', label: 'SaaS' }],
    includeGeo: input.includeGeo ?? [],
    excludeGeo: input.excludeGeo ?? [],
    priorityMarkets: input.priorityMarkets ?? [],
    notes: input.notes ?? null,
    recommendedPlan: { lane: input.lane, tier: input.mode ?? 'focused', code: 'opportunity-focused' },
  });
  service.buildCampaignObjective = () => 'Reach qualified accounts';
  service.buildCampaignOfferSummary = () => 'Managed outbound';
  service.findPrimaryCampaignSnapshot = async () => ({ id: 'camp_a', activation: {}, generationState: 'TARGETING_READY', metadataJson: null });
  service.buildCampaignHealthSnapshot = async () => ({ health: 'ACTIVE', metrics: {}, mailbox: null, imports: null, execution: null, permissions: null });
  service.prisma = {
    campaign: {
      findFirst: async () => ({ id: 'camp_a', status: 'READY' }),
      findUnique: async () => ({ metadataJson: null }),
      update: async () => ({}),
    },
    client: { update: async () => ({}) },
  };

  const result = await service.startCampaign({});
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(activationInput, { campaignId: 'camp_a', organizationId: 'org_a' });
}

async function testInvalidCampaignCommercialStateCannotStart() {
  const service = new ClientsService({} as any, {} as any, {} as any, {
    activateCampaign: async () => {
      throw new Error('activation should not run without commercial coverage');
    },
  } as any, {} as any) as any;

  service.resolveClientForRequest = async () => ({
    id: 'client_a',
    organizationId: 'org_a',
    metadataJson: { setup: { scope: {} } },
    scopeJson: null,
  });
  service.resolveCommercialState = async () => ({ service: null, tier: null });
  service.buildSubscriptionAlignment = () => ({ tierCovered: false });

  const result = await service.startCampaign({});
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.status, 'upgrade_required');
}

async function testValidCampaignActivationQueuesLeadImport() {
  let createdJob: any;
  let updatedCampaign: any;
  const service = new CampaignsService(
    {
      campaign: {
        findFirst: async () => ({
          id: 'camp_a',
          organizationId: 'org_a',
          clientId: 'client_a',
          workflowRunId: 'wf_a',
          timezone: 'America/New_York',
          status: 'READY',
          generationState: 'TARGETING_READY',
          metadataJson: {},
        }),
        update: async (input: any) => {
          updatedCampaign = input;
          return {};
        },
      },
      job: {
        findFirst: async () => null,
        create: async (input: any) => {
          createdJob = input;
          return { id: 'job_a', ...input.data };
        },
      },
    } as any,
    {} as any,
    {
      ensureDefaultMailboxInfrastructure: async () => ({
        mailbox: {
          id: 'mailbox_a',
          emailAddress: 'outreach@example.com',
          label: 'Outreach',
          status: 'ACTIVE',
          healthStatus: 'HEALTHY',
          connectionState: 'CONNECTED',
        },
      }),
    } as any,
    {
      decide: async () => ({ decisionId: 'decision_a', snapshot: { entity: {} } }),
    } as any,
    {
      enforce: async () => ({ allowed: true }),
    } as any,
  ) as any;

  service.getCampaignOperationalView = async () => ({ execution: { state: 'IMPORTING' } });

  const result = await service.activateCampaign({ campaignId: 'camp_a', organizationId: 'org_a' });
  assert.strictEqual(result.status, 'activation_requested');
  assert.strictEqual(createdJob.data.type, JobType.LEAD_IMPORT);
  assert.strictEqual(createdJob.data.status, JobStatus.QUEUED);
  assert.strictEqual(createdJob.data.organizationId, 'org_a');
  assert.strictEqual(createdJob.data.clientId, 'client_a');
  assert.strictEqual(updatedCampaign.data.status, 'ACTIVE');
}

async function testOperatorLeadQueueIsOrganizationScoped() {
  let leadWhere: any;
  const service = new ExecutionService(
    {
      lead: {
        findFirst: async (input: any) => {
          leadWhere = input.where;
          return null;
        },
      },
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  await expectRejectsWith(
    () => service.queueLeadSend('lead_b', { organizationId: 'org_a', jobType: JobType.FIRST_SEND }),
    NotFoundException,
  );
  assert.deepStrictEqual(leadWhere, { id: 'lead_b', organizationId: 'org_a' });
}

async function testFailedWorkerStateVisibleInExecutionSurface() {
  const failedJob = {
    id: 'job_failed',
    type: JobType.LEAD_IMPORT,
    status: JobStatus.FAILED,
    queueName: 'lead-import',
    lastError: 'Provider timed out',
    attemptCount: 3,
    maxAttempts: 3,
    updatedAt: new Date('2026-04-29T12:00:00Z'),
  };
  const service = new WorkflowsService({
    campaign: {
      findFirst: async (input: any) => {
        assert.deepStrictEqual(input.where, { id: 'camp_a', organizationId: 'org_a', clientId: 'client_a' });
        return { id: 'camp_a', organizationId: 'org_a', clientId: 'client_a', metadataJson: {} };
      },
    },
    workflowRun: { findFirst: async () => null },
    job: {
      count: async (input: any) => input.where.status === JobStatus.FAILED ? 1 : 0,
      findMany: async () => [failedJob],
    },
    outreachMessage: { count: async () => 0 },
    reply: { count: async () => 0 },
    meeting: { count: async () => 0 },
    lead: { count: async () => 0 },
    contactConsent: { count: async () => 0 },
  } as any);

  const surface = await service.getCampaignExecutionSurface('camp_a', {
    organizationId: 'org_a',
    clientId: 'client_a',
  }) as any;

  assert.strictEqual(surface.counts.failed, 1);
  assert.strictEqual(surface.failedJobs[0].lastError, 'Provider timed out');
}

async function main() {
  await testUnauthorizedCampaignStartRejected();
  await testClientStartScopesCampaignActivation();
  await testInvalidCampaignCommercialStateCannotStart();
  await testValidCampaignActivationQueuesLeadImport();
  await testOperatorLeadQueueIsOrganizationScoped();
  await testFailedWorkerStateVisibleInExecutionSurface();
  console.log('outreach lifecycle tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
