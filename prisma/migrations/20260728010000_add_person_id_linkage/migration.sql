-- AlterTable
ALTER TABLE "ScheduleImport" ADD COLUMN     "personId" INTEGER;

-- AlterTable
ALTER TABLE "ProgressUpdate" ADD COLUMN     "personId" INTEGER;

-- AlterTable
ALTER TABLE "CompletenessDismissal" ADD COLUMN     "personId" INTEGER;

-- AlterTable
ALTER TABLE "CompletenessSplit" ADD COLUMN     "personId" INTEGER;

-- AlterTable
ALTER TABLE "TradeScopeDismissal" ADD COLUMN     "personId" INTEGER;

