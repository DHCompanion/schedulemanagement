-- AlterTable
ALTER TABLE "ScheduleImport" ADD COLUMN "isSynthetic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScheduleImport" ADD COLUMN "derivedFromImportId" TEXT;

-- CreateTable
CREATE TABLE "CompletenessSplit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceScheduleImportId" TEXT NOT NULL,
    "resultScheduleImportId" TEXT NOT NULL,
    "coarseExternalUid" INTEGER NOT NULL,
    "coarseWbsCode" TEXT,
    "coarseOutlineNumber" TEXT,
    "coarseOutlineLevel" INTEGER NOT NULL DEFAULT 0,
    "coarseName" TEXT NOT NULL,
    "coarseDurationMinutes" DOUBLE PRECISION,
    "coarseStart" TIMESTAMP(3),
    "coarseFinish" TIMESTAMP(3),
    "finerScopes" JSONB NOT NULL,
    "mintedUids" JSONB NOT NULL,
    "acceptedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletenessSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompletenessSplit_resultScheduleImportId_key" ON "CompletenessSplit"("resultScheduleImportId");

-- CreateIndex
CREATE INDEX "CompletenessSplit_projectId_idx" ON "CompletenessSplit"("projectId");

-- AddForeignKey
ALTER TABLE "ScheduleImport" ADD CONSTRAINT "ScheduleImport_derivedFromImportId_fkey" FOREIGN KEY ("derivedFromImportId") REFERENCES "ScheduleImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletenessSplit" ADD CONSTRAINT "CompletenessSplit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletenessSplit" ADD CONSTRAINT "CompletenessSplit_resultScheduleImportId_fkey" FOREIGN KEY ("resultScheduleImportId") REFERENCES "ScheduleImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
