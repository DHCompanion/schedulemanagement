-- Additive: two tables rebuilt from imported schedules. Reversible with DROP TABLE.
CREATE TABLE "ScopeCriticality" (
    "canonicalScope" TEXT NOT NULL,
    "groupKind" TEXT NOT NULL,
    "groupValue" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "critical" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeCriticality_pkey" PRIMARY KEY ("canonicalScope","groupKind","groupValue")
);

CREATE TABLE "ScopeSequence" (
    "fromScope" TEXT NOT NULL,
    "toScope" TEXT NOT NULL,
    "groupKind" TEXT NOT NULL,
    "groupValue" TEXT NOT NULL,
    "projects" INTEGER NOT NULL,
    "base" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "lagDays" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeSequence_pkey" PRIMARY KEY ("fromScope","toScope","groupKind","groupValue")
);
