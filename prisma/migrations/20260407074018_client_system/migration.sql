-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'INCOMPLETE';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "area" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "scopeJson" JSONB,
ADD COLUMN     "selectedPlan" TEXT,
ADD COLUMN     "setupCompletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Client_organizationId_selectedPlan_idx" ON "Client"("organizationId", "selectedPlan");

-- CreateIndex
CREATE INDEX "Client_organizationId_setupCompletedAt_idx" ON "Client"("organizationId", "setupCompletedAt");
