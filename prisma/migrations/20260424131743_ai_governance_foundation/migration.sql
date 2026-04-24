-- CreateEnum
CREATE TYPE "AiDecisionRecordStatus" AS ENUM ('RECORDED', 'ENFORCED', 'EXPIRED', 'SUPERSEDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AiDecisionLinkRole" AS ENUM ('PRIMARY_SUBJECT', 'CONTEXT', 'TARGET', 'RELATED', 'OUTCOME_SUBJECT');

-- CreateEnum
CREATE TYPE "AiEnforcementStatus" AS ENUM ('ALLOWED', 'BLOCKED', 'EXPIRED', 'NOT_FOUND', 'ENTITY_MISMATCH', 'POLICY_BLOCKED', 'HUMAN_REVIEW_REQUIRED', 'TRUST_BLOCKED', 'AUDIT_ONLY');

-- CreateEnum
CREATE TYPE "AiDecisionOutcomeStatus" AS ENUM ('OBSERVED', 'SUCCEEDED', 'FAILED', 'PARTIAL', 'CANCELED');

-- CreateEnum
CREATE TYPE "AiPolicyBindingStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'EXPIRED');

-- CreateTable
CREATE TABLE "AiDecisionRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "campaignId" TEXT,
    "workflowRunId" TEXT,
    "scope" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "effectiveAction" TEXT,
    "actor" TEXT NOT NULL,
    "jobType" TEXT,
    "allowedToProceed" BOOLEAN NOT NULL DEFAULT false,
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DECIMAL(5,4),
    "risk" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "blockersJson" JSONB,
    "notesJson" JSONB,
    "metadataJson" JSONB,
    "policyMetadataJson" JSONB,
    "snapshotVersion" TEXT,
    "snapshotGeneratedAt" TIMESTAMP(3),
    "trustMode" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ai_governance_gateway',
    "status" "AiDecisionRecordStatus" NOT NULL DEFAULT 'RECORDED',
    "expiresAt" TIMESTAMP(3),
    "enforcedAt" TIMESTAMP(3),
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDecisionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDecisionEntityLink" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "role" "AiDecisionLinkRole" NOT NULL DEFAULT 'CONTEXT',
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDecisionEntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEnforcementRecord" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "campaignId" TEXT,
    "workflowRunId" TEXT,
    "jobId" TEXT,
    "serviceName" TEXT NOT NULL,
    "methodName" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" "AiEnforcementStatus" NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "metadataJson" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiEnforcementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDecisionOutcome" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "campaignId" TEXT,
    "workflowRunId" TEXT,
    "jobId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "outcomeType" TEXT NOT NULL,
    "status" "AiDecisionOutcomeStatus" NOT NULL DEFAULT 'OBSERVED',
    "score" DECIMAL(5,4),
    "summary" TEXT,
    "metadataJson" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDecisionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDecisionPolicyBinding" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "campaignId" TEXT,
    "scope" TEXT NOT NULL,
    "action" TEXT,
    "bindingKey" TEXT NOT NULL,
    "bindingValueJson" JSONB,
    "trustMode" TEXT,
    "requiredConfidence" DECIMAL(5,4),
    "requiresHumanReview" BOOLEAN NOT NULL DEFAULT false,
    "automationAllowed" BOOLEAN NOT NULL DEFAULT false,
    "status" "AiPolicyBindingStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadataJson" JSONB,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDecisionPolicyBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiDecisionRecord_organizationId_createdAt_idx" ON "AiDecisionRecord"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDecisionRecord_organizationId_scope_action_createdAt_idx" ON "AiDecisionRecord"("organizationId", "scope", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AiDecisionRecord_clientId_createdAt_idx" ON "AiDecisionRecord"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDecisionRecord_campaignId_createdAt_idx" ON "AiDecisionRecord"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDecisionRecord_workflowRunId_createdAt_idx" ON "AiDecisionRecord"("workflowRunId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDecisionRecord_status_expiresAt_idx" ON "AiDecisionRecord"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "AiDecisionEntityLink_decisionId_role_idx" ON "AiDecisionEntityLink"("decisionId", "role");

-- CreateIndex
CREATE INDEX "AiDecisionEntityLink_organizationId_entityType_entityId_cre_idx" ON "AiDecisionEntityLink"("organizationId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiDecisionEntityLink_decisionId_entityType_entityId_role_key" ON "AiDecisionEntityLink"("decisionId", "entityType", "entityId", "role");

-- CreateIndex
CREATE INDEX "AiEnforcementRecord_organizationId_checkedAt_idx" ON "AiEnforcementRecord"("organizationId", "checkedAt");

-- CreateIndex
CREATE INDEX "AiEnforcementRecord_decisionId_checkedAt_idx" ON "AiEnforcementRecord"("decisionId", "checkedAt");

-- CreateIndex
CREATE INDEX "AiEnforcementRecord_entityType_entityId_checkedAt_idx" ON "AiEnforcementRecord"("entityType", "entityId", "checkedAt");

-- CreateIndex
CREATE INDEX "AiEnforcementRecord_workflowRunId_checkedAt_idx" ON "AiEnforcementRecord"("workflowRunId", "checkedAt");

-- CreateIndex
CREATE INDEX "AiEnforcementRecord_jobId_checkedAt_idx" ON "AiEnforcementRecord"("jobId", "checkedAt");

-- CreateIndex
CREATE INDEX "AiDecisionOutcome_decisionId_observedAt_idx" ON "AiDecisionOutcome"("decisionId", "observedAt");

-- CreateIndex
CREATE INDEX "AiDecisionOutcome_organizationId_observedAt_idx" ON "AiDecisionOutcome"("organizationId", "observedAt");

-- CreateIndex
CREATE INDEX "AiDecisionOutcome_entityType_entityId_observedAt_idx" ON "AiDecisionOutcome"("entityType", "entityId", "observedAt");

-- CreateIndex
CREATE INDEX "AiDecisionPolicyBinding_decisionId_idx" ON "AiDecisionPolicyBinding"("decisionId");

-- CreateIndex
CREATE INDEX "AiDecisionPolicyBinding_organizationId_scope_bindingKey_sta_idx" ON "AiDecisionPolicyBinding"("organizationId", "scope", "bindingKey", "status");

-- CreateIndex
CREATE INDEX "AiDecisionPolicyBinding_clientId_scope_status_idx" ON "AiDecisionPolicyBinding"("clientId", "scope", "status");

-- CreateIndex
CREATE INDEX "AiDecisionPolicyBinding_campaignId_scope_status_idx" ON "AiDecisionPolicyBinding"("campaignId", "scope", "status");

-- AddForeignKey
ALTER TABLE "AiDecisionRecord" ADD CONSTRAINT "AiDecisionRecord_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "AiDecisionRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDecisionEntityLink" ADD CONSTRAINT "AiDecisionEntityLink_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AiDecisionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEnforcementRecord" ADD CONSTRAINT "AiEnforcementRecord_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AiDecisionRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDecisionOutcome" ADD CONSTRAINT "AiDecisionOutcome_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AiDecisionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDecisionPolicyBinding" ADD CONSTRAINT "AiDecisionPolicyBinding_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AiDecisionRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
