-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "aiDecisionId" TEXT;

-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN     "aiDecisionId" TEXT;

-- CreateIndex
CREATE INDEX "Job_aiDecisionId_idx" ON "Job"("aiDecisionId");

-- CreateIndex
CREATE INDEX "WorkflowRun_aiDecisionId_idx" ON "WorkflowRun"("aiDecisionId");

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_aiDecisionId_fkey" FOREIGN KEY ("aiDecisionId") REFERENCES "AiDecisionRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_aiDecisionId_fkey" FOREIGN KEY ("aiDecisionId") REFERENCES "AiDecisionRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
