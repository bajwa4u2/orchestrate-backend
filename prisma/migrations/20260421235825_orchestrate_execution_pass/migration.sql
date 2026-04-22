-- CreateTable
CREATE TABLE "OpportunityProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "opportunityType" TEXT NOT NULL,
    "targetDescription" TEXT,
    "geographyScope" JSONB,
    "serviceContext" TEXT,
    "offerContext" TEXT,
    "exclusions" JSONB,
    "strategyJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "opportunityProfileId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "signalSourceType" TEXT NOT NULL,
    "sourceUrlOrKey" TEXT,
    "headlineOrLabel" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recencyScore" DECIMAL(5,2),
    "confidenceScore" DECIMAL(5,2),
    "geography" TEXT,
    "payloadJson" JSONB,
    "normalizedJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcePlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "opportunityProfileId" TEXT NOT NULL,
    "planVersion" INTEGER NOT NULL DEFAULT 1,
    "sourcePriorityJson" JSONB,
    "fallbackPolicyJson" JSONB,
    "signalRulesJson" JSONB,
    "executionLimitsJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sourcePlanId" TEXT NOT NULL,
    "opportunityProfileId" TEXT,
    "sourceType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "costUnits" INTEGER NOT NULL DEFAULT 0,
    "notesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredEntity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sourceRunId" TEXT,
    "opportunityProfileId" TEXT,
    "companyName" TEXT NOT NULL,
    "personName" TEXT,
    "inferredRole" TEXT,
    "websiteUrl" TEXT,
    "domain" TEXT,
    "geography" TEXT,
    "sourceEvidenceJson" JSONB,
    "entityConfidence" DECIMAL(5,2),
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveredEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReachabilityRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "discoveredEntityId" TEXT NOT NULL,
    "domain" TEXT,
    "contactPageUrl" TEXT,
    "emailCandidate" TEXT,
    "emailPattern" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "reachabilityScore" DECIMAL(5,2),
    "suppressionStatus" TEXT,
    "notesJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReachabilityRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "discoveredEntityId" TEXT NOT NULL,
    "opportunityProfileId" TEXT,
    "decision" TEXT NOT NULL,
    "relevanceScore" DECIMAL(5,2),
    "timelinessScore" DECIMAL(5,2),
    "reachabilityScore" DECIMAL(5,2),
    "valueScore" DECIMAL(5,2),
    "finalScore" DECIMAL(5,2),
    "reasonJson" JSONB,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualificationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderUsageLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "opportunityProfileId" TEXT,
    "providerName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "invocationType" TEXT NOT NULL,
    "costUnits" INTEGER NOT NULL DEFAULT 0,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "outcomeSummary" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdaptationDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "opportunityProfileId" TEXT,
    "triggerType" TEXT NOT NULL,
    "previousPathJson" JSONB,
    "newPathJson" JSONB,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdaptationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpportunityProfile_campaignId_status_idx" ON "OpportunityProfile"("campaignId", "status");

-- CreateIndex
CREATE INDEX "OpportunityProfile_clientId_status_idx" ON "OpportunityProfile"("clientId", "status");

-- CreateIndex
CREATE INDEX "OpportunityProfile_organizationId_status_idx" ON "OpportunityProfile"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SignalEvent_campaignId_signalType_detectedAt_idx" ON "SignalEvent"("campaignId", "signalType", "detectedAt");

-- CreateIndex
CREATE INDEX "SignalEvent_opportunityProfileId_signalType_idx" ON "SignalEvent"("opportunityProfileId", "signalType");

-- CreateIndex
CREATE INDEX "SourcePlan_campaignId_status_idx" ON "SourcePlan"("campaignId", "status");

-- CreateIndex
CREATE INDEX "SourcePlan_opportunityProfileId_status_idx" ON "SourcePlan"("opportunityProfileId", "status");

-- CreateIndex
CREATE INDEX "SourceRun_campaignId_sourceType_status_idx" ON "SourceRun"("campaignId", "sourceType", "status");

-- CreateIndex
CREATE INDEX "SourceRun_sourcePlanId_status_idx" ON "SourceRun"("sourcePlanId", "status");

-- CreateIndex
CREATE INDEX "DiscoveredEntity_campaignId_status_idx" ON "DiscoveredEntity"("campaignId", "status");

-- CreateIndex
CREATE INDEX "DiscoveredEntity_sourceRunId_idx" ON "DiscoveredEntity"("sourceRunId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredEntity_campaignId_dedupeKey_key" ON "DiscoveredEntity"("campaignId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ReachabilityRecord_campaignId_verificationStatus_idx" ON "ReachabilityRecord"("campaignId", "verificationStatus");

-- CreateIndex
CREATE INDEX "ReachabilityRecord_discoveredEntityId_idx" ON "ReachabilityRecord"("discoveredEntityId");

-- CreateIndex
CREATE INDEX "ReachabilityRecord_emailCandidate_idx" ON "ReachabilityRecord"("emailCandidate");

-- CreateIndex
CREATE INDEX "QualificationDecision_campaignId_decision_decidedAt_idx" ON "QualificationDecision"("campaignId", "decision", "decidedAt");

-- CreateIndex
CREATE INDEX "QualificationDecision_discoveredEntityId_idx" ON "QualificationDecision"("discoveredEntityId");

-- CreateIndex
CREATE INDEX "ProviderUsageLog_campaignId_providerName_createdAt_idx" ON "ProviderUsageLog"("campaignId", "providerName", "createdAt");

-- CreateIndex
CREATE INDEX "AdaptationDecision_campaignId_triggerType_createdAt_idx" ON "AdaptationDecision"("campaignId", "triggerType", "createdAt");
