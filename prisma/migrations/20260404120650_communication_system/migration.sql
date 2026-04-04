/*
  Warnings:

  - The `deliveryChannel` column on the `DocumentDispatch` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('SUPPORT', 'BILLING', 'LEGAL', 'HELLO', 'NO_REPLY');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('ACCOUNT_WELCOME', 'ACCOUNT_EMAIL_VERIFICATION', 'ACCOUNT_PASSWORD_RESET', 'ACCOUNT_SECURITY_ALERT', 'ACCOUNT_APPROVED', 'ACCOUNT_REJECTED', 'CONTACT_ACKNOWLEDGEMENT', 'DEMO_ACKNOWLEDGEMENT', 'EARLY_ACCESS_CONFIRMATION', 'OUTREACH_REPLY_ACKNOWLEDGEMENT', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_CANCELED', 'INVOICE_ISSUED', 'INVOICE_PAYMENT_DUE_REMINDER', 'INVOICE_PAYMENT_OVERDUE_REMINDER', 'PAYMENT_RECEIVED', 'PAYMENT_FAILED', 'REFUND_ISSUED', 'STATEMENT_ISSUED', 'STATEMENT_READY_REMINDER', 'AGREEMENT_SENT', 'AGREEMENT_SIGNATURE_REQUEST', 'AGREEMENT_SIGNED', 'AGREEMENT_REVISION_SENT', 'TERMS_UPDATED', 'COMPLIANCE_REQUEST', 'CLIENT_ONBOARDING_STARTED', 'CLIENT_ONBOARDING_COMPLETED', 'CAMPAIGN_LAUNCHED', 'LEAD_DELIVERY_NOTICE', 'MEETING_BOOKED_NOTICE', 'SERVICE_ISSUE_ALERT', 'SERVICE_SETUP_REMINDER', 'SYSTEM_STATUS_NOTICE', 'SECURE_LINK_DELIVERY', 'SECURE_LINK_EXPIRING');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP', 'INTERNAL', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "EmailDeliveryProvider" AS ENUM ('RESEND', 'SMTP', 'MANUAL', 'INTERNAL');

-- CreateEnum
CREATE TYPE "EmailDeliveryMode" AS ENUM ('RESEND', 'LOG', 'DISABLED', 'MANUAL');

-- CreateEnum
CREATE TYPE "MailboxRole" AS ENUM ('PRIMARY_OUTREACH', 'SUPPORT', 'BILLING', 'LEGAL', 'HELLO', 'NO_REPLY', 'GENERAL');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "billingContactName" TEXT,
ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "legalContactName" TEXT,
ADD COLUMN     "legalEmail" TEXT,
ADD COLUMN     "opsContactName" TEXT,
ADD COLUMN     "opsEmail" TEXT,
ADD COLUMN     "primaryContactName" TEXT,
ADD COLUMN     "primaryEmail" TEXT;

-- AlterTable
ALTER TABLE "DocumentDispatch" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryMode" "EmailDeliveryMode",
ADD COLUMN     "deliveryProvider" "EmailDeliveryProvider",
ADD COLUMN     "emailCategory" "EmailCategory",
ADD COLUMN     "emailEvent" "EmailEventType",
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "fromEmail" TEXT,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "mailboxId" TEXT,
ADD COLUMN     "replyToEmail" TEXT,
ADD COLUMN     "transportMetadataJson" JSONB,
DROP COLUMN "deliveryChannel",
ADD COLUMN     "deliveryChannel" "DeliveryChannel" NOT NULL DEFAULT 'EMAIL';

-- AlterTable
ALTER TABLE "Mailbox" ADD COLUMN     "fromName" TEXT,
ADD COLUMN     "replyToAddress" TEXT,
ADD COLUMN     "role" "MailboxRole" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "defaultEmailCategory" "EmailCategory",
ADD COLUMN     "defaultEmailEvent" "EmailEventType",
ADD COLUMN     "deliveryChannel" "DeliveryChannel" NOT NULL DEFAULT 'EMAIL',
ADD COLUMN     "fromEmailOverride" TEXT,
ADD COLUMN     "fromNameOverride" TEXT,
ADD COLUMN     "legalFooterRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replyToEmailOverride" TEXT,
ADD COLUMN     "subjectLinePrefix" TEXT,
ADD COLUMN     "transactionalOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Client_organizationId_primaryEmail_idx" ON "Client"("organizationId", "primaryEmail");

-- CreateIndex
CREATE INDEX "Client_organizationId_billingEmail_idx" ON "Client"("organizationId", "billingEmail");

-- CreateIndex
CREATE INDEX "Client_organizationId_legalEmail_idx" ON "Client"("organizationId", "legalEmail");

-- CreateIndex
CREATE INDEX "DocumentDispatch_organizationId_deliveryChannel_status_idx" ON "DocumentDispatch"("organizationId", "deliveryChannel", "status");

-- CreateIndex
CREATE INDEX "DocumentDispatch_organizationId_emailCategory_createdAt_idx" ON "DocumentDispatch"("organizationId", "emailCategory", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentDispatch_organizationId_emailEvent_createdAt_idx" ON "DocumentDispatch"("organizationId", "emailEvent", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentDispatch_mailboxId_createdAt_idx" ON "DocumentDispatch"("mailboxId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentDispatch_status_lastAttemptAt_idx" ON "DocumentDispatch"("status", "lastAttemptAt");

-- CreateIndex
CREATE INDEX "Mailbox_organizationId_role_status_idx" ON "Mailbox"("organizationId", "role", "status");

-- CreateIndex
CREATE INDEX "Mailbox_clientId_role_status_idx" ON "Mailbox"("clientId", "role", "status");

-- CreateIndex
CREATE INDEX "Template_organizationId_defaultEmailCategory_isActive_idx" ON "Template"("organizationId", "defaultEmailCategory", "isActive");

-- CreateIndex
CREATE INDEX "Template_organizationId_defaultEmailEvent_isActive_idx" ON "Template"("organizationId", "defaultEmailEvent", "isActive");

-- AddForeignKey
ALTER TABLE "DocumentDispatch" ADD CONSTRAINT "DocumentDispatch_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
