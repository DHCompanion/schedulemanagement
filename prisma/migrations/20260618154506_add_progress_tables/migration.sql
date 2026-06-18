-- CreateTable
CREATE TABLE "ProgressUpdate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scheduleImportId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "lookaheadWeeks" INTEGER NOT NULL DEFAULT 3,
    "state" TEXT NOT NULL DEFAULT 'draft',
    "submittedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "ProgressUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressEntry" (
    "id" TEXT NOT NULL,
    "progressUpdateId" TEXT NOT NULL,
    "activityExternalUid" INTEGER NOT NULL,
    "canonicalActivityKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "actualStart" TIMESTAMP(3),
    "actualFinish" TIMESTAMP(3),
    "percentComplete" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgressUpdate_projectId_idx" ON "ProgressUpdate"("projectId");

-- CreateIndex
CREATE INDEX "ProgressUpdate_scheduleImportId_idx" ON "ProgressUpdate"("scheduleImportId");

-- CreateIndex
CREATE INDEX "ProgressEntry_progressUpdateId_idx" ON "ProgressEntry"("progressUpdateId");

-- CreateIndex
CREATE INDEX "ProgressEntry_canonicalActivityKey_idx" ON "ProgressEntry"("canonicalActivityKey");

-- AddForeignKey
ALTER TABLE "ProgressUpdate" ADD CONSTRAINT "ProgressUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressUpdate" ADD CONSTRAINT "ProgressUpdate_scheduleImportId_fkey" FOREIGN KEY ("scheduleImportId") REFERENCES "ScheduleImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_progressUpdateId_fkey" FOREIGN KEY ("progressUpdateId") REFERENCES "ProgressUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

