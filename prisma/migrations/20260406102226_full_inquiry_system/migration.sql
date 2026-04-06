/*
  Warnings:

  - The values [RECEIVED,NOTIFIED] on the enum `PublicInquiryStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "InquiryDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'SYSTEM');

-- CreateEnum
CREATE TYPE "InquiryChannel" AS ENUM ('EMAIL', 'INTERNAL');

-- CreateEnum
CREATE TYPE "InquiryMessageType" AS ENUM ('CUSTOMER', 'OPERATOR_REPLY', 'AUTO_ACK', 'STATUS_CHANGE', 'ASSIGNMENT', 'NOTE', 'SYNC');

-- AlterEnum
BEGIN;
CREATE TYPE "PublicInquiryStatus_new" AS ENUM ('NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'CLOSED', 'SPAM');
ALTER TABLE "public"."PublicInquiry" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PublicInquiry" ALTER COLUMN "status" TYPE "PublicInquiryStatus_new" USING ("status"::text::"PublicInquiryStatus_new");
ALTER TYPE "PublicInquiryStatus" RENAME TO "PublicInquiryStatus_old";
ALTER TYPE "PublicInquiryStatus_new" RENAME TO "PublicInquiryStatus";
DROP TYPE "public"."PublicInquiryStatus_old";
ALTER TABLE "PublicInquiry" ALTER COLUMN "status" SET DEFAULT 'NEW';
COMMIT;

-- AlterTable
ALTER TABLE "PublicInquiry" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedToUserId" TEXT,
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "externalThreadId" TEXT,
ADD COLUMN     "firstRespondedAt" TIMESTAMP(3),
ADD COLUMN     "firstResponseDueAt" TIMESTAMP(3),
ADD COLUMN     "isEscalated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "lastInboundAt" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3),
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "mailboxId" TEXT,
ADD COLUMN     "nextResponseDueAt" TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT 'NEW';

-- CreateTable
CREATE TABLE "InquiryMessage" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "direction" "InquiryDirection" NOT NULL,
    "channel" "InquiryChannel" NOT NULL,
    "messageType" "InquiryMessageType" NOT NULL,
    "subjectLine" TEXT,
    "bodyText" TEXT NOT NULL,
    "fromEmail" TEXT,
    "toEmail" TEXT,
    "ccJson" JSONB,
    "externalMessageId" TEXT,
    "externalThreadId" TEXT,
    "mailboxId" TEXT,
    "createdByUserId" TEXT,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InquiryMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryNote" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "bodyText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InquiryNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InquiryMessage_inquiryId_createdAt_idx" ON "InquiryMessage"("inquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "InquiryMessage_mailboxId_createdAt_idx" ON "InquiryMessage"("mailboxId", "createdAt");

-- CreateIndex
CREATE INDEX "InquiryMessage_createdByUserId_createdAt_idx" ON "InquiryMessage"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "InquiryMessage_direction_createdAt_idx" ON "InquiryMessage"("direction", "createdAt");

-- CreateIndex
CREATE INDEX "InquiryMessage_messageType_createdAt_idx" ON "InquiryMessage"("messageType", "createdAt");

-- CreateIndex
CREATE INDEX "InquiryMessage_externalMessageId_idx" ON "InquiryMessage"("externalMessageId");

-- CreateIndex
CREATE INDEX "InquiryMessage_externalThreadId_idx" ON "InquiryMessage"("externalThreadId");

-- CreateIndex
CREATE INDEX "InquiryNote_inquiryId_createdAt_idx" ON "InquiryNote"("inquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "InquiryNote_authorUserId_createdAt_idx" ON "InquiryNote"("authorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PublicInquiry_assignedToUserId_status_idx" ON "PublicInquiry"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "PublicInquiry_mailboxId_idx" ON "PublicInquiry"("mailboxId");

-- CreateIndex
CREATE INDEX "PublicInquiry_externalThreadId_idx" ON "PublicInquiry"("externalThreadId");

-- CreateIndex
CREATE INDEX "PublicInquiry_isEscalated_status_idx" ON "PublicInquiry"("isEscalated", "status");

-- CreateIndex
CREATE INDEX "PublicInquiry_lastActivityAt_idx" ON "PublicInquiry"("lastActivityAt");

-- AddForeignKey
ALTER TABLE "PublicInquiry" ADD CONSTRAINT "PublicInquiry_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicInquiry" ADD CONSTRAINT "PublicInquiry_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryMessage" ADD CONSTRAINT "InquiryMessage_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "PublicInquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryMessage" ADD CONSTRAINT "InquiryMessage_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "Mailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryMessage" ADD CONSTRAINT "InquiryMessage_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryNote" ADD CONSTRAINT "InquiryNote_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "PublicInquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryNote" ADD CONSTRAINT "InquiryNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
