-- AlterTable
ALTER TABLE "Project" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

-- Backfill: existing projects are treated as already onboarded so they are
-- not retroactively forced through the first-time setup wizard added in
-- Slice 5e.
UPDATE "Project" SET "onboardingCompletedAt" = CURRENT_TIMESTAMP WHERE "onboardingCompletedAt" IS NULL;
