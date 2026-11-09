-- Additive: safe draft saves. Reverse: DROP INDEX "ProgressUpdate_one_draft_per_project";
-- DROP INDEX "ProgressEntry_progressUpdateId_canonicalActivityKey_key";
-- ALTER TABLE "ProgressEntry" DROP COLUMN "changedByPersonId".
ALTER TABLE "ProgressEntry" ADD COLUMN "changedByPersonId" INTEGER;

CREATE UNIQUE INDEX "ProgressEntry_progressUpdateId_canonicalActivityKey_key" ON "ProgressEntry"("progressUpdateId", "canonicalActivityKey");

-- One open draft per project (partial; not expressible in schema.prisma).
CREATE UNIQUE INDEX "ProgressUpdate_one_draft_per_project" ON "ProgressUpdate"("projectId") WHERE "state" = 'draft';
