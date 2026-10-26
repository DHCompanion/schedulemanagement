-- Additive with a default: existing projects stay in benchmarks. Reverse: DROP COLUMN.
ALTER TABLE "Project" ADD COLUMN "useInBenchmarks" BOOLEAN NOT NULL DEFAULT true;
