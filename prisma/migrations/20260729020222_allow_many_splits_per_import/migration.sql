-- DropIndex
DROP INDEX "CompletenessSplit_resultScheduleImportId_key";

-- CreateIndex
CREATE INDEX "CompletenessSplit_resultScheduleImportId_idx" ON "CompletenessSplit"("resultScheduleImportId");
