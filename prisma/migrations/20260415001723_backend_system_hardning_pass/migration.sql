-- CreateTable
CREATE TABLE "WebhookEventReceipt" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEventReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEventReceipt_provider_status_idx" ON "WebhookEventReceipt"("provider", "status");

-- CreateIndex
CREATE INDEX "WebhookEventReceipt_createdAt_idx" ON "WebhookEventReceipt"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEventReceipt_provider_eventId_key" ON "WebhookEventReceipt"("provider", "eventId");
