-- CreateEnum
CREATE TYPE "InvoiceLineType" AS ENUM ('SERVICE', 'SUBSCRIPTION', 'USAGE', 'ADJUSTMENT', 'DISCOUNT', 'TAX', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceAccessEventType" AS ENUM ('EMAIL_SENT', 'EMAIL_DELIVERED', 'EMAIL_OPENED', 'LINK_OPENED', 'PDF_VIEWED', 'PDF_DOWNLOADED', 'PORTAL_VIEWED');

-- CreateEnum
CREATE TYPE "InvoiceActorType" AS ENUM ('CLIENT', 'OPERATOR', 'SYSTEM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceStatus" ADD VALUE 'SENT';
ALTER TYPE "InvoiceStatus" ADD VALUE 'VIEWED';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "balanceDueCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "billingPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "billingPeriodStart" TIMESTAMP(3),
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastSentAt" TIMESTAMP(3),
ADD COLUMN     "pdfFileKey" TEXT,
ADD COLUMN     "pdfFileUrl" TEXT,
ADD COLUMN     "pdfGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "termsText" TEXT,
ADD COLUMN     "viewedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "subtotalCents" INTEGER,
ADD COLUMN     "taxCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "type" "InvoiceLineType" NOT NULL DEFAULT 'SERVICE';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "noteText" TEXT;

-- CreateTable
CREATE TABLE "InvoiceAccessEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "invoiceId" TEXT NOT NULL,
    "documentDispatchId" TEXT,
    "eventType" "InvoiceAccessEventType" NOT NULL,
    "actorType" "InvoiceActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceAccessEvent_organizationId_eventType_occurredAt_idx" ON "InvoiceAccessEvent"("organizationId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "InvoiceAccessEvent_invoiceId_eventType_occurredAt_idx" ON "InvoiceAccessEvent"("invoiceId", "eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "InvoiceAccessEvent_documentDispatchId_idx" ON "InvoiceAccessEvent"("documentDispatchId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_status_createdAt_idx" ON "Invoice"("organizationId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "InvoiceAccessEvent" ADD CONSTRAINT "InvoiceAccessEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAccessEvent" ADD CONSTRAINT "InvoiceAccessEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceAccessEvent" ADD CONSTRAINT "InvoiceAccessEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
