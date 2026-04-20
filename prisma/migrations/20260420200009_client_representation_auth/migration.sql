-- CreateTable
CREATE TABLE "ClientRepresentationAuth" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "acceptedByUserId" TEXT,
    "acceptedByName" TEXT,
    "acceptedByEmail" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientRepresentationAuth_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientRepresentationAuth_organizationId_idx" ON "ClientRepresentationAuth"("organizationId");

-- CreateIndex
CREATE INDEX "ClientRepresentationAuth_organizationId_clientId_idx" ON "ClientRepresentationAuth"("organizationId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientRepresentationAuth_clientId_version_key" ON "ClientRepresentationAuth"("clientId", "version");

-- AddForeignKey
ALTER TABLE "ClientRepresentationAuth" ADD CONSTRAINT "ClientRepresentationAuth_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRepresentationAuth" ADD CONSTRAINT "ClientRepresentationAuth_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
