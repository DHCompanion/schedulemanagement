-- A discarded draft keeps its agent writes' keys (progressUpdateId cleared), so a late resend of a saved write gets
-- its first answer instead of recreating the discarded draft.
ALTER TABLE "AgentWrite" ALTER COLUMN "progressUpdateId" DROP NOT NULL;
ALTER TABLE "AgentWrite" DROP CONSTRAINT "AgentWrite_progressUpdateId_fkey";
ALTER TABLE "AgentWrite" ADD CONSTRAINT "AgentWrite_progressUpdateId_fkey" FOREIGN KEY ("progressUpdateId") REFERENCES "ProgressUpdate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
