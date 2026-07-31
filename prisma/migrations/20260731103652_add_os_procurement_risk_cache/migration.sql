-- CreateTable
CREATE TABLE "OsProcurementRisk" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "osPartnerId" INTEGER NOT NULL,
    "partnerName" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "atRiskCount" INTEGER NOT NULL,
    "openVarianceCount" INTEGER NOT NULL,
    "earliestRequiredOnSite" TIMESTAMP(3),
    "leastAdvancedState" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OsProcurementRisk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OsProcurementRisk_projectId_osPartnerId_key" ON "OsProcurementRisk"("projectId", "osPartnerId");

-- AddForeignKey
ALTER TABLE "OsProcurementRisk" ADD CONSTRAINT "OsProcurementRisk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
