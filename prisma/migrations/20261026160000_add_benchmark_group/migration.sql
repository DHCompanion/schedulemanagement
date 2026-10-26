-- Additive: one table rebuilt by "Recompute benchmarks". Reversible with DROP TABLE "BenchmarkGroup".
CREATE TABLE "BenchmarkGroup" (
    "groupKind" TEXT NOT NULL,
    "groupValue" TEXT NOT NULL,
    "projects" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchmarkGroup_pkey" PRIMARY KEY ("groupKind","groupValue")
);
