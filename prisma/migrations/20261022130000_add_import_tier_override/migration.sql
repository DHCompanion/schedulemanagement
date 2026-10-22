-- A reviewer-set tier (lib/health/importTier.ts ImportTier) that overrides the
-- computed one, e.g. "rough" for pull plans. Null = use the computed tier.
ALTER TABLE "ScheduleImport" ADD COLUMN "tierOverride" TEXT;
