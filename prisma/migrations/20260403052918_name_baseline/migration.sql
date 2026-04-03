-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('DRAFT', 'ISSUED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CollectionActionKind" AS ENUM ('PAYMENT_REMINDER', 'OVERDUE_NOTICE', 'MANUAL_FOLLOW_UP', 'SERVICE_HOLD', 'WRITE_OFF_REVIEW');

-- CreateEnum
CREATE TYPE "CollectionActionStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ReminderArtifactKind" AS ENUM ('PAYMENT_DUE', 'PAYMENT_OVERDUE', 'STATEMENT_READY', 'AGREEMENT_SIGNATURE', 'SERVICE_FOLLOW_UP');

-- CreateEnum
CREATE TYPE "ReminderArtifactStatus" AS ENUM ('PENDING', 'SENT', 'ACKNOWLEDGED', 'CANCELED');

-- CreateEnum
CREATE TYPE "DocumentDispatchStatus" AS ENUM ('RENDERED', 'ISSUED', 'SENT', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TemplateType" ADD VALUE 'WELCOME';
ALTER TYPE "TemplateType" ADD VALUE 'SUBSCRIPTION';
ALTER TYPE "TemplateType" ADD VALUE 'INVOICE';
ALTER TYPE "TemplateType" ADD VALUE 'RECEIPT';
ALTER TYPE "TemplateType" ADD VALUE 'AGREEMENT';
ALTER TYPE "TemplateType" ADD VALUE 'STATEMENT';
ALTER TYPE "TemplateType" ADD VALUE 'REMINDER';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "billingProfileId" TEXT;

-- CreateTable
CREATE TABLE "BillingProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "addressJson" JSONB,
    "taxId" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "defaultCurrencyCode" TEXT NOT NULL DEFAULT 'USD',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "serviceCategory" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmountCents" INTEGER NOT NULL,
    "totalAmountCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "amountCents" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "creditNoteNumber" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "amountCents" INTEGER NOT NULL,
    "reasonText" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Statement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdById" TEXT,
    "statementNumber" TEXT NOT NULL,
    "label" TEXT,
    "status" "StatementStatus" NOT NULL DEFAULT 'DRAFT',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalInvoicedCents" INTEGER NOT NULL DEFAULT 0,
    "totalPaidCents" INTEGER NOT NULL DEFAULT 0,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementInvoiceLink" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,

    CONSTRAINT "StatementInvoiceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementPaymentLink" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,

    CONSTRAINT "StatementPaymentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "reminderId" TEXT,
    "kind" "CollectionActionKind" NOT NULL,
    "status" "CollectionActionStatus" NOT NULL DEFAULT 'OPEN',
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "noteText" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceAgreement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "createdById" TEXT,
    "agreementNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveStartAt" TIMESTAMP(3),
    "effectiveEndAt" TIMESTAMP(3),
    "termsText" TEXT,
    "acceptedByName" TEXT,
    "acceptedByEmail" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderArtifact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdById" TEXT,
    "invoiceId" TEXT,
    "agreementId" TEXT,
    "kind" "ReminderArtifactKind" NOT NULL,
    "status" "ReminderArtifactStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "subjectLine" TEXT,
    "bodyText" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentDispatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "templateId" TEXT,
    "invoiceId" TEXT,
    "statementId" TEXT,
    "agreementId" TEXT,
    "receiptId" TEXT,
    "reminderId" TEXT,
    "kind" "TemplateType" NOT NULL,
    "status" "DocumentDispatchStatus" NOT NULL DEFAULT 'RENDERED',
    "deliveryChannel" TEXT NOT NULL DEFAULT 'EMAIL',
    "recipientEmail" TEXT,
    "recipientName" TEXT,
    "subjectLine" TEXT,
    "bodyText" TEXT,
    "payloadJson" JSONB,
    "externalMessageId" TEXT,
    "failureMessage" TEXT,
    "renderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingProfile_organizationId_clientId_idx" ON "BillingProfile"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_sortOrder_idx" ON "InvoiceLine"("invoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "Receipt_clientId_issuedAt_idx" ON "Receipt"("clientId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_organizationId_receiptNumber_key" ON "Receipt"("organizationId", "receiptNumber");

-- CreateIndex
CREATE INDEX "CreditNote_clientId_issuedAt_idx" ON "CreditNote"("clientId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_organizationId_creditNoteNumber_key" ON "CreditNote"("organizationId", "creditNoteNumber");

-- CreateIndex
CREATE INDEX "Statement_clientId_periodEnd_idx" ON "Statement"("clientId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Statement_organizationId_statementNumber_key" ON "Statement"("organizationId", "statementNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StatementInvoiceLink_statementId_invoiceId_key" ON "StatementInvoiceLink"("statementId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "StatementPaymentLink_statementId_paymentId_key" ON "StatementPaymentLink"("statementId", "paymentId");

-- CreateIndex
CREATE INDEX "CollectionAction_clientId_status_scheduledAt_idx" ON "CollectionAction"("clientId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ServiceAgreement_clientId_status_idx" ON "ServiceAgreement"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAgreement_organizationId_agreementNumber_key" ON "ServiceAgreement"("organizationId", "agreementNumber");

-- CreateIndex
CREATE INDEX "ReminderArtifact_clientId_status_scheduledAt_idx" ON "ReminderArtifact"("clientId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "DocumentDispatch_organizationId_kind_status_idx" ON "DocumentDispatch"("organizationId", "kind", "status");

-- CreateIndex
CREATE INDEX "DocumentDispatch_clientId_kind_createdAt_idx" ON "DocumentDispatch"("clientId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentDispatch_recipientEmail_createdAt_idx" ON "DocumentDispatch"("recipientEmail", "createdAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_billingProfileId_fkey" FOREIGN KEY ("billingProfileId") REFERENCES "BillingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingProfile" ADD CONSTRAINT "BillingProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingProfile" ADD CONSTRAINT "BillingProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Statement" ADD CONSTRAINT "Statement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Statement" ADD CONSTRAINT "Statement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Statement" ADD CONSTRAINT "Statement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementInvoiceLink" ADD CONSTRAINT "StatementInvoiceLink_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "Statement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementInvoiceLink" ADD CONSTRAINT "StatementInvoiceLink_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementPaymentLink" ADD CONSTRAINT "StatementPaymentLink_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "Statement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementPaymentLink" ADD CONSTRAINT "StatementPaymentLink_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAction" ADD CONSTRAINT "CollectionAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAction" ADD CONSTRAINT "CollectionAction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAction" ADD CONSTRAINT "CollectionAction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAction" ADD CONSTRAINT "CollectionAction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionAction" ADD CONSTRAINT "CollectionAction_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "ReminderArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAgreement" ADD CONSTRAINT "ServiceAgreement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAgreement" ADD CONSTRAINT "ServiceAgreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAgreement" ADD CONSTRAINT "ServiceAgreement_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAgreement" ADD CONSTRAINT "ServiceAgreement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderArtifact" ADD CONSTRAINT "ReminderArtifact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderArtifact" ADD CONSTRAINT "ReminderArtifact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderArtifact" ADD CONSTRAINT "ReminderArtifact_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderArtifact" ADD CONSTRAINT "ReminderArtifact_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderArtifact" ADD CONSTRAINT "ReminderArtifact_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "ServiceAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDispatch" ADD CONSTRAINT "DocumentDispatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDispatch" ADD CONSTRAINT "DocumentDispatch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDispatch" ADD CONSTRAINT "DocumentDispatch_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDispatch" ADD CONSTRAINT "DocumentDispatch_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDispatch" ADD CONSTRAINT "DocumentDispatch_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "Statement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDispatch" ADD CONSTRAINT "DocumentDispatch_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "ServiceAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDispatch" ADD CONSTRAINT "DocumentDispatch_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentDispatch" ADD CONSTRAINT "DocumentDispatch_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "ReminderArtifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
