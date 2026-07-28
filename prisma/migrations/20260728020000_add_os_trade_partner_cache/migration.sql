-- CreateTable
CREATE TABLE "OsTradePartner" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "osPartnerId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "disciplines" JSONB NOT NULL,
    "doNotUse" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OsTradePartner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OsTradePartner_projectId_idx" ON "OsTradePartner"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "OsTradePartner_projectId_osPartnerId_key" ON "OsTradePartner"("projectId", "osPartnerId");

-- AddForeignKey
ALTER TABLE "OsTradePartner" ADD CONSTRAINT "OsTradePartner_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

