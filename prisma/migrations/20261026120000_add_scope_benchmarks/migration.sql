-- Additive: a new table rebuilt from imported schedules. Reversible with DROP TABLE "ScopeBenchmark".
CREATE TABLE "ScopeBenchmark" (
    "canonicalScope" TEXT NOT NULL,
    "measure" TEXT NOT NULL,
    "groupKind" TEXT NOT NULL,
    "groupValue" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "p25" DOUBLE PRECISION NOT NULL,
    "median" DOUBLE PRECISION NOT NULL,
    "p75" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeBenchmark_pkey" PRIMARY KEY ("canonicalScope","measure","groupKind","groupValue")
);
