# Outreach / Lead / Campaign Flow Audit

Date: 2026-04-29

## Scope

Audited the backend path for public/contact intake, client setup and campaign profile, campaign start/restart, operator campaign activation, lead creation/listing, source/import work, message/send jobs, reply ingestion/classification, meeting handoff, campaign operational views, client campaign overview, and operator command execution surfaces.

## Lifecycle Map

| Stage | Endpoint | Controller | Service | Records/state changed | Downstream work/status returned |
| --- | --- | --- | --- | --- | --- |
| Public intake | `POST /intake/public` | `IntakeController` | `IntakeService` | `PublicInquiry`, inquiry messages | Validated public support/intake response with no internal leakage |
| Client setup | `POST /clients/me/setup` | `ClientsController` | `ClientsService.saveSetup` | `Client.scopeJson`, setup metadata | Client campaign profile can derive targeting and plan alignment |
| Campaign profile read/update | `GET/PATCH /client/campaign-profile` | `ClientCampaignController` | `ClientsService` | `Client` setup metadata, primary campaign metadata | Returns campaign, setup, subscription alignment, execution summaries |
| Client start | `POST /client/campaign-profile/start` | `ClientCampaignController` | `ClientsService.startCampaign` -> `CampaignsService.activateCampaign` | Primary `Campaign` created/updated, `Campaign.status=ACTIVE`, `generationState=TARGETING_READY` | Queues `LEAD_IMPORT` job and returns activation status/job/mailbox/execution |
| Client restart | `POST /client/campaign-profile/restart` | `ClientCampaignController` | `ClientsService.restartCampaign` -> `CampaignsService.activateCampaign` | Campaign metadata governor reset, restart cooldown stamped | Reuses/dedupes activation job or queues new import |
| Operator activation | `POST /campaigns/:id/activate` | `CampaignsController` | `CampaignsService.activateCampaign` | Campaign activation metadata | Requires operator org scope and queues `LEAD_IMPORT` |
| Lead creation/import | `POST /leads` and worker imports | `LeadsController`, workers | `LeadsService`, `WorkersService` | `Account`, `Contact`, `LeadSource`, `Lead`, `ActivityEvent`; campaign can move to `LEADS_READY` | Lead inventory becomes visible to client/operator |
| Lead send queue | `POST /execution/leads/:leadId/queue-first-send`, `queue-follow-up` | `ExecutionController` | `ExecutionService.queueLeadSend` | `WorkflowRun`, `Job` | Queues `FIRST_SEND`/`FOLLOWUP_SEND`; now scoped by operator organization |
| Immediate send/dispatch | `POST /execution/jobs/:jobId/run`, dispatch loop | `ExecutionController` | `ExecutionService.runJob`, workers | `JobRun`, `Job`, `OutreachMessage`, `Lead`, `Campaign` | Captures retry/failure and updates activation metadata on import failure |
| Replies | `POST /replies/inbound` | `RepliesController` | `RepliesService` | `Reply`, lead reply/interest state, possible `Meeting` | Secret enforcement remains required in production |
| Client overview | `GET /client/campaign/overview`, `/client/leads` | `ClientPortalController` | `ClientPortalService` | Read-only | Returns scoped campaign, execution, mailbox, import, permission, lead states |
| Operator surface | `GET /operator/command`, `/operator/command/campaigns/:id/execution-surface`, `/workflows/campaigns/:id/execution-surface` | `OperatorController`, `WorkflowsController` | `OperatorService`, `WorkflowsService` | Read-only | Returns scoped workflow/execution truth, including failed job samples |

## Endpoint Matrix

| Surface | Route | Guard | Scope source | Notes |
| --- | --- | --- | --- | --- |
| Client | `/client/campaign-profile*` | `requireClient` | signed client context | Start/restart cannot pass raw client/org IDs |
| Client | `/clients/me/campaign-overview` | `requireClient` | signed client context | Delegates to campaign profile truth |
| Client | `/client/leads` | `requireClient` | signed client context | Now returns lead metadata/suppression reason needed by frontend blocking display |
| Operator | `/campaigns`, `/campaigns/:id/activate` | `requireOperator` | signed operator org context | Activation is org-scoped |
| Operator | `/leads`, `/leads/:leadId/*` | `requireOperator` | signed operator org context | Queue/test-send now passes org into execution service |
| Operator | `/execution/leads/:leadId/*`, `/execution/jobs/:jobId/run` | `requireOperator` | signed operator org context | Raw lead/job IDs no longer authorize cross-org work |
| Operator | `/operator/command/campaigns/:id/execution-surface` | `requireOperator` | signed operator org context | Execution surface now scoped |
| Operator | `/workflows/campaigns/:id/execution-surface` | `requireOperator` | signed operator org context | Execution surface now scoped |
| Public/webhook | `/replies/inbound` | shared secret in production | inbound secret | Existing secret enforcement kept and tested |

## State Matrix

| Entity | States audited |
| --- | --- |
| Campaign | `DRAFT`, `READY`, `ACTIVE`, `PAUSED`, `COMPLETED`, `ARCHIVED`; generation states include `TARGETING_READY`, `LEADS_READY`, `ACTIVE`; activation metadata includes `activation_requested`, `activation_in_progress`, `activation_retry_scheduled`, `activation_completed`, `activation_failed` |
| Lead | `NEW`, `ENRICHED`, `QUALIFIED`, `CONTACTED`, `FOLLOWED_UP`, `REPLIED`, `INTERESTED`, `HANDOFF_PENDING`, `BOOKED`, `CLOSED_LOST`, `SUPPRESSED` |
| Job | `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELED`, `RETRY_SCHEDULED` |
| Message | `QUEUED`, `SCHEDULED`, `SENT`, `DELIVERED`, `OPENED`, `CLICKED`, `REPLIED`, `BOUNCED`, `FAILED`, `CANCELED`; lifecycle `DRAFT`, `APPROVED`, `SCHEDULED`, `DISPATCHED`, `DELIVERED`, `REPLIED`, `BOUNCED`, `FAILED` |
| Reply | `INTERESTED`, `NOT_NOW`, `NOT_RELEVANT`, `REFERRAL`, `UNSUBSCRIBE`, `OOO`, `BOUNCE`, `UNCLEAR`, `HUMAN_REVIEW` |
| Meeting handoff | `PROPOSED`, `BOOKED`, `COMPLETED`, `CANCELED`, `NO_SHOW` |
| Error/blocked | Failed jobs, retry scheduled jobs, activation failed metadata, mailbox wait, consent block, suppression block |

## Discrepancies Found

- `WorkflowsService.getCampaignExecutionSurface` accepted raw campaign IDs and counted workflow/jobs/messages/replies without org/client scoping.
- Operator execution actions queued or ran work from raw `leadId`/`jobId` without enforcing the signed operator organization in `ExecutionService`.
- Client campaign start called `activateCampaign` without passing the resolved client organization, leaving one internal activation path less constrained than restart/operator activation.
- `CampaignsService.getCampaignOperationalView` read campaign status with unscoped `findUnique` even though counts were scoped.
- Client lead listing did not return `metadataJson` or `suppressionReason`, while the frontend used lead metadata to summarize blocked leads.
- Failed worker/job details were counted but not exposed in workflow execution surfaces.

## Fixes Made

- Scoped workflow execution surfaces by `organizationId` and optional `clientId`; not-found scoped access returns a safe `NOT_FOUND` execution surface.
- Added failed job samples to campaign execution surface output.
- Passed operator organization through `LeadsController` and `ExecutionController` into queue/test-send/run paths.
- Changed `ExecutionService.queueLeadSend`, `runJob`, and `runImmediateSendForLead` to use scoped `findFirst` queries when an organization scope is present.
- Added `organizationId` to `RunJobDto` for internal controller-to-service scope propagation.
- Passed client organization into client campaign start activation.
- Scoped campaign operational view campaign read by organization/client.
- Added lead metadata and suppression reason to client lead responses.
- Added lifecycle tests for unauthorized start, scoped client activation, invalid commercial start block, activation queue creation, operator lead queue scoping, and failed job visibility.

## Files Changed

- `package.json`
- `src/campaigns/campaigns.service.ts`
- `src/client-portal/client-portal.service.ts`
- `src/clients/clients.service.ts`
- `src/execution/dto/run-job.dto.ts`
- `src/execution/execution.controller.ts`
- `src/execution/execution.service.ts`
- `src/leads/leads.controller.ts`
- `src/leads/leads.service.ts`
- `src/operator/operator.controller.ts`
- `src/workflows/workflows.controller.ts`
- `src/workflows/workflows.service.ts`
- `test/outreach-lifecycle.spec.ts`
- `docs/OUTREACH_LEAD_CAMPAIGN_FLOW_AUDIT.md`

## Tests Added

- `test/outreach-lifecycle.spec.ts`
  - unauthorized campaign start rejected
  - client activation passes authorized organization scope
  - invalid commercial/setup gate prevents activation
  - valid campaign activation queues `LEAD_IMPORT`
  - operator lead queue rejects cross-org raw lead access
  - failed worker/job state is visible in execution surface

## Validation Results

- `npm run build` passed.
- `npm test` passed:
  - `security-hardening tests passed`
  - `outreach lifecycle tests passed`

## Remaining Intentional Limitations

- Execution still supports internal service calls without an explicit organization scope for worker/dispatcher paths; public/operator controllers now pass scope, while internal jobs rely on stored job organization/client fields.
- This pass did not redesign sourcing/provider worker internals; it hardened the lifecycle boundaries and visibility around activation, execution, and failed states.
- Manual browser/API exercise was not run from this environment, but backend build/tests passed and frontend campaign screens compile/analyze/test cleanly.
