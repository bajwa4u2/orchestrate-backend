-- CreateEnum
CREATE TYPE "WorkflowLane" AS ENUM ('ACTIVATION', 'GROWTH', 'REVENUE', 'DOCUMENTS', 'COMMUNICATIONS');

-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('TRIAL_ACTIVATION', 'SUBSCRIPTION_ACTIVATION', 'CAMPAIGN_GENERATION', 'OUTREACH_EXECUTION', 'FOLLOW_UP_EXECUTION', 'REPLY_PROCESSING', 'MEETING_CONVERSION', 'BILLING_CYCLE', 'PAYMENT_COLLECTION', 'AGREEMENT_ISSUANCE', 'STATEMENT_ISSUANCE', 'REMINDER_DISPATCH', 'DOCUMENT_DISPATCH');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'REQUIRES_REVIEW', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "WorkflowTrigger" AS ENUM ('USER_ACTION', 'SYSTEM_EVENT', 'SCHEDULED', 'SUBSCRIPTION_EVENT', 'PAYMENT_EVENT', 'MANUAL_OPERATOR', 'POLICY_RULE');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('AI_GENERATED', 'SYSTEM_GENERATED', 'USER_CREATED', 'OPERATOR_CREATED', 'IMPORTED', 'EXTERNAL_SYNC');

-- CreateEnum
CREATE TYPE "GenerationState" AS ENUM ('INIT', 'TARGETING_READY', 'LEADS_READY', 'MESSAGES_READY', 'SEQUENCE_READY', 'READY_TO_LAUNCH', 'ACTIVE', 'FAILED');

-- CreateEnum
CREATE TYPE "LeadQualificationState" AS ENUM ('DISCOVERED', 'QUALIFIED', 'ENROLLED', 'CONTACTED', 'REPLIED', 'INTERESTED', 'DISQUALIFIED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "MessageLifecycle" AS ENUM ('DRAFT', 'APPROVED', 'SCHEDULED', 'DISPATCHED', 'DELIVERED', 'REPLIED', 'BOUNCED', 'FAILED');

-- CreateEnum
CREATE TYPE "ArtifactLifecycle" AS ENUM ('DRAFT', 'ISSUED', 'DISPATCHED', 'DELIVERED', 'ACKNOWLEDGED', 'VOIDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DispatchLifecycle" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'FAILED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "ActivityVisibility" AS ENUM ('INTERNAL', 'CLIENT_VISIBLE', 'OPERATOR_VISIBLE');

-- DropIndex
DROP INDEX "DocumentDispatch_clientId_kind_createdAt_idx";

-- DropIndex
DROP INDEX "DocumentDispatch_mailboxId_createdAt_idx";

-- DropIndex
DROP INDEX "DocumentDispatch_organizationId_deliveryChannel_status_idx";

-- DropIndex
DROP INDEX "DocumentDispatch_organizationId_emailCategory_createdAt_idx";

-- DropIndex
DROP INDEX "DocumentDispatch_organizationId_emailEvent_createdAt_idx";

-- DropIndex
DROP INDEX "DocumentDispatch_recipientEmail_createdAt_idx";

-- DropIndex
DROP INDEX "DocumentDispatch_status_lastAttemptAt_idx";

-- AlterTable
ALTER TABLE "ActivityEvent" ADD COLUMN     "visibility" "ActivityVisibility" NOT NULL DEFAULT 'INTERNAL',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "generationState" "GenerationState",
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'USER_CREATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN     "lifecycle" "ArtifactLifecycle",
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'SYSTEM_GENERATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "DocumentDispatch" ADD COLUMN     "dispatchState" "DispatchLifecycle",
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'SYSTEM_GENERATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "lifecycle" "ArtifactLifecycle",
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'SYSTEM_GENERATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "JobRun" ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "qualificationState" "LeadQualificationState",
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'USER_CREATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "LeadEnrollment" ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "LeadSource" ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'USER_CREATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'SYSTEM_GENERATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN     "lifecycle" "MessageLifecycle" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'USER_CREATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'SYSTEM_GENERATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "lifecycle" "ArtifactLifecycle",
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'SYSTEM_GENERATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "ReminderArtifact" ADD COLUMN     "lifecycle" "ArtifactLifecycle",
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'SYSTEM_GENERATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "Reply" ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'EXTERNAL_SYNC',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "Sequence" ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'SYSTEM_GENERATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "ServiceAgreement" ADD COLUMN     "lifecycle" "ArtifactLifecycle",
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'SYSTEM_GENERATED',
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "Statement" ADD COLUMN     "lifecycle" "ArtifactLifecycle",
ADD COLUMN     "source" "RecordSource" NOT NULL DEFAULT 'SYSTEM_GENERATED',
ADD COLUMN     "workflowRunId" TEXT;

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "campaignId" TEXT,
    "invoiceId" TEXT,
    "serviceAgreementId" TEXT,
    "statementId" TEXT,
    "lane" "WorkflowLane" NOT NULL,
    "type" "WorkflowType" NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" "WorkflowTrigger" NOT NULL,
    "source" "RecordSource" NOT NULL DEFAULT 'SYSTEM_GENERATED',
    "title" TEXT,
    "inputJson" JSONB,
    "contextJson" JSONB,
    "resultJson" JSONB,
    "errorJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowRun_organizationId_lane_type_status_idx" ON "WorkflowRun"("organizationId", "lane", "type", "status");

-- CreateIndex
CREATE INDEX "WorkflowRun_clientId_lane_type_status_idx" ON "WorkflowRun"("clientId", "lane", "type", "status");

-- CreateIndex
CREATE INDEX "WorkflowRun_subscriptionId_idx" ON "WorkflowRun"("subscriptionId");

-- CreateIndex
CREATE INDEX "WorkflowRun_campaignId_idx" ON "WorkflowRun"("campaignId");

-- CreateIndex
CREATE INDEX "WorkflowRun_invoiceId_idx" ON "WorkflowRun"("invoiceId");

-- CreateIndex
CREATE INDEX "WorkflowRun_serviceAgreementId_idx" ON "WorkflowRun"("serviceAgreementId");

-- CreateIndex
CREATE INDEX "WorkflowRun_statementId_idx" ON "WorkflowRun"("statementId");

-- CreateIndex
CREATE INDEX "WorkflowRun_createdAt_idx" ON "WorkflowRun"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_workflowRunId_createdAt_idx" ON "ActivityEvent"("workflowRunId", "createdAt");

-- CreateIndex
CREATE INDEX "Campaign_workflowRunId_idx" ON "Campaign"("workflowRunId");

-- CreateIndex
CREATE INDEX "CreditNote_workflowRunId_idx" ON "CreditNote"("workflowRunId");

-- CreateIndex
CREATE INDEX "DocumentDispatch_workflowRunId_idx" ON "DocumentDispatch"("workflowRunId");

-- CreateIndex
CREATE INDEX "Invoice_workflowRunId_idx" ON "Invoice"("workflowRunId");

-- CreateIndex
CREATE INDEX "JobRun_workflowRunId_idx" ON "JobRun"("workflowRunId");

-- CreateIndex
CREATE INDEX "Lead_workflowRunId_idx" ON "Lead"("workflowRunId");

-- CreateIndex
CREATE INDEX "LeadEnrollment_workflowRunId_idx" ON "LeadEnrollment"("workflowRunId");

-- CreateIndex
CREATE INDEX "LeadSource_workflowRunId_idx" ON "LeadSource"("workflowRunId");

-- CreateIndex
CREATE INDEX "Meeting_workflowRunId_idx" ON "Meeting"("workflowRunId");

-- CreateIndex
CREATE INDEX "OutreachMessage_workflowRunId_idx" ON "OutreachMessage"("workflowRunId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_workflowRunId_idx" ON "PaymentAttempt"("workflowRunId");

-- CreateIndex
CREATE INDEX "Receipt_workflowRunId_idx" ON "Receipt"("workflowRunId");

-- CreateIndex
CREATE INDEX "ReminderArtifact_workflowRunId_idx" ON "ReminderArtifact"("workflowRunId");

-- CreateIndex
CREATE INDEX "Reply_workflowRunId_idx" ON "Reply"("workflowRunId");

-- CreateIndex
CREATE INDEX "Sequence_workflowRunId_idx" ON "Sequence"("workflowRunId");

-- CreateIndex
CREATE INDEX "ServiceAgreement_workflowRunId_idx" ON "ServiceAgreement"("workflowRunId");

-- CreateIndex
CREATE INDEX "Statement_workflowRunId_idx" ON "Statement"("workflowRunId");

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSource" ADD CONSTRAINT "LeadSource_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEnrollment" ADD CONSTRAINT "LeadEnrollment_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Statement" ADD CONSTRAINT "Statement_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAgreement" ADD CONSTRAINT "ServiceAgreement_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderArtifact" ADD CONSTRAINT "ReminderArtifact_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDispatch" ADD CONSTRAINT "DocumentDispatch_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
