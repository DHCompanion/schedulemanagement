-- CreateTable
CREATE TABLE "TradeDriftDismissal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "osDisciplineId" INTEGER NOT NULL,
    "fileValue" TEXT NOT NULL,
    "dismissedBy" TEXT,
    "personId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeDriftDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeDriftDismissal_projectId_idx" ON "TradeDriftDismissal"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeDriftDismissal_projectId_osDisciplineId_fileValue_key" ON "TradeDriftDismissal"("projectId", "osDisciplineId", "fileValue");

-- AddForeignKey
ALTER TABLE "TradeDriftDismissal" ADD CONSTRAINT "TradeDriftDismissal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
