-- CreateEnum
CREATE TYPE "PublicInquiryType" AS ENUM ('SERVICE_FIT', 'PRICING', 'BILLING_SUPPORT', 'ONBOARDING', 'PARTNERSHIP', 'GENERAL_INQUIRY');

-- CreateEnum
CREATE TYPE "PublicInquiryStatus" AS ENUM ('RECEIVED', 'NOTIFIED', 'ACKNOWLEDGED', 'CLOSED', 'SPAM');

-- CreateTable
CREATE TABLE "PublicInquiry" (
    "id" TEXT NOT NULL,
    "inquiryType" "PublicInquiryType" NOT NULL,
    "status" "PublicInquiryStatus" NOT NULL DEFAULT 'RECEIVED',
    "source" TEXT NOT NULL DEFAULT 'public_contact_form',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "message" TEXT NOT NULL,
    "metadataJson" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicInquiry_status_submittedAt_idx" ON "PublicInquiry"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "PublicInquiry_email_idx" ON "PublicInquiry"("email");

-- CreateIndex
CREATE INDEX "PublicInquiry_inquiryType_submittedAt_idx" ON "PublicInquiry"("inquiryType", "submittedAt");
