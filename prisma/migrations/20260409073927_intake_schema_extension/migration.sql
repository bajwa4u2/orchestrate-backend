-- CreateEnum
CREATE TYPE "InquirySource" AS ENUM ('PUBLIC', 'CLIENT');

-- CreateEnum
CREATE TYPE "InquiryAccountType" AS ENUM ('PUBLIC', 'CLIENT');

-- CreateEnum
CREATE TYPE "InquiryCategory" AS ENUM ('PRICING', 'BILLING', 'SUPPORT', 'TECHNICAL', 'ONBOARDING', 'SALES', 'PARTNERSHIP', 'COMPLIANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "InquiryIntent" AS ENUM ('QUESTION', 'ISSUE', 'REQUEST', 'COMPLAINT');

-- CreateEnum
CREATE TYPE "InquiryPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "InquiryMessageAuthorType" AS ENUM ('USER', 'AI', 'OPERATOR', 'SYSTEM');

-- CreateEnum
CREATE TYPE "InquiryMessageVisibility" AS ENUM ('PUBLIC_THREAD', 'INTERNAL_ONLY');

-- CreateEnum
CREATE TYPE "InquiryNoteType" AS ENUM ('AI_SUMMARY', 'OPERATOR_NOTE', 'ESCALATION_NOTE', 'SYSTEM_NOTE');

-- AlterTable
ALTER TABLE "InquiryMessage" ADD COLUMN     "authorType" "InquiryMessageAuthorType" NOT NULL DEFAULT 'USER',
ADD COLUMN     "visibility" "InquiryMessageVisibility" NOT NULL DEFAULT 'PUBLIC_THREAD';

-- AlterTable
ALTER TABLE "InquiryNote" ADD COLUMN     "noteType" "InquiryNoteType" NOT NULL DEFAULT 'OPERATOR_NOTE';

-- AlterTable
ALTER TABLE "PublicInquiry" ADD COLUMN     "accountType" "InquiryAccountType" NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN     "aiConfidence" DECIMAL(5,4),
ADD COLUMN     "aiRawJson" JSONB,
ADD COLUMN     "aiSuggestedReply" TEXT,
ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "category" "InquiryCategory",
ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "dedupeHash" TEXT,
ADD COLUMN     "followUpStateJson" JSONB,
ADD COLUMN     "intakeSessionId" TEXT,
ADD COLUMN     "intent" "InquiryIntent",
ADD COLUMN     "planContext" TEXT,
ADD COLUMN     "priority" "InquiryPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "requiresHuman" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "resolvedByAi" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shouldAskFollowUp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceKind" "InquirySource" NOT NULL DEFAULT 'PUBLIC',
ADD COLUMN     "sourcePage" TEXT,
ADD COLUMN     "tierContext" TEXT,
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "InquiryMessage_authorType_createdAt_idx" ON "InquiryMessage"("authorType", "createdAt");

-- CreateIndex
CREATE INDEX "InquiryMessage_visibility_createdAt_idx" ON "InquiryMessage"("visibility", "createdAt");

-- CreateIndex
CREATE INDEX "InquiryNote_noteType_createdAt_idx" ON "InquiryNote"("noteType", "createdAt");

-- CreateIndex
CREATE INDEX "PublicInquiry_sourceKind_status_submittedAt_idx" ON "PublicInquiry"("sourceKind", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "PublicInquiry_accountType_status_submittedAt_idx" ON "PublicInquiry"("accountType", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "PublicInquiry_category_priority_status_idx" ON "PublicInquiry"("category", "priority", "status");

-- CreateIndex
CREATE INDEX "PublicInquiry_userId_status_submittedAt_idx" ON "PublicInquiry"("userId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "PublicInquiry_clientId_status_submittedAt_idx" ON "PublicInquiry"("clientId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "PublicInquiry_intakeSessionId_idx" ON "PublicInquiry"("intakeSessionId");

-- CreateIndex
CREATE INDEX "PublicInquiry_dedupeHash_idx" ON "PublicInquiry"("dedupeHash");

-- AddForeignKey
ALTER TABLE "PublicInquiry" ADD CONSTRAINT "PublicInquiry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicInquiry" ADD CONSTRAINT "PublicInquiry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
