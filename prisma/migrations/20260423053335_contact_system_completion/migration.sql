-- CreateEnum
CREATE TYPE "ContactChannelType" AS ENUM ('EMAIL', 'PHONE', 'LINKEDIN', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactChannelStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BOUNCED', 'INVALID', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "CommunicationType" AS ENUM ('OUTREACH', 'NEWSLETTER', 'TRANSACTIONAL');

-- CreateEnum
CREATE TYPE "ContactConsentStatus" AS ENUM ('ALLOWED', 'BLOCKED', 'SUBSCRIBED', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "MailboxConnectionState" AS ENUM ('PENDING_AUTH', 'AUTHORIZED', 'REQUIRES_REAUTH', 'REVOKED', 'BOOTSTRAPPED');

-- CreateEnum
CREATE TYPE "MessageClass" AS ENUM ('OUTREACH', 'NEWSLETTER', 'TRANSACTIONAL', 'SYSTEM');

-- AlterTable
ALTER TABLE "Mailbox" ADD COLUMN     "connectedAt" TIMESTAMP(3),
ADD COLUMN     "connectionState" "MailboxConnectionState" NOT NULL DEFAULT 'PENDING_AUTH',
ADD COLUMN     "disconnectedAt" TIMESTAMP(3),
ADD COLUMN     "isClientOwned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastAuthAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN     "contactChannelId" TEXT,
ADD COLUMN     "messageClass" "MessageClass" NOT NULL DEFAULT 'OUTREACH';

-- CreateTable
CREATE TABLE "ContactChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" "ContactChannelType" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "status" "ContactChannelStatus" NOT NULL DEFAULT 'ACTIVE',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationSource" TEXT,
    "metadataJson" JSONB,
    "lastValidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactConsent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "contactChannelId" TEXT,
    "communication" "CommunicationType" NOT NULL,
    "status" "ContactConsentStatus" NOT NULL,
    "source" "RecordSource",
    "sourceLabel" TEXT,
    "reason" TEXT,
    "metadataJson" JSONB,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT,
    "workflowRunId" TEXT,
    "sourceLabel" TEXT,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactChannel_organizationId_clientId_type_status_idx" ON "ContactChannel"("organizationId", "clientId", "type", "status");

-- CreateIndex
CREATE INDEX "ContactChannel_normalizedValue_idx" ON "ContactChannel"("normalizedValue");

-- CreateIndex
CREATE UNIQUE INDEX "ContactChannel_contactId_type_normalizedValue_key" ON "ContactChannel"("contactId", "type", "normalizedValue");

-- CreateIndex
CREATE INDEX "ContactConsent_organizationId_clientId_communication_status_idx" ON "ContactConsent"("organizationId", "clientId", "communication", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContactConsent_contactId_contactChannelId_communication_key" ON "ContactConsent"("contactId", "contactChannelId", "communication");

-- CreateIndex
CREATE INDEX "ImportBatch_organizationId_clientId_status_idx" ON "ImportBatch"("organizationId", "clientId", "status");

-- CreateIndex
CREATE INDEX "ImportBatch_campaignId_status_idx" ON "ImportBatch"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Mailbox_clientId_connectionState_status_idx" ON "Mailbox"("clientId", "connectionState", "status");

-- CreateIndex
CREATE INDEX "OutreachMessage_contactChannelId_idx" ON "OutreachMessage"("contactChannelId");

-- AddForeignKey
ALTER TABLE "ContactChannel" ADD CONSTRAINT "ContactChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactChannel" ADD CONSTRAINT "ContactChannel_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactChannel" ADD CONSTRAINT "ContactChannel_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactConsent" ADD CONSTRAINT "ContactConsent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactConsent" ADD CONSTRAINT "ContactConsent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactConsent" ADD CONSTRAINT "ContactConsent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactConsent" ADD CONSTRAINT "ContactConsent_contactChannelId_fkey" FOREIGN KEY ("contactChannelId") REFERENCES "ContactChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_contactChannelId_fkey" FOREIGN KEY ("contactChannelId") REFERENCES "ContactChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
