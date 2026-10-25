-- CreateTable
CREATE TABLE "StandardScope" (
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandardScope_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "ScopeNameClass" (
    "normalizedName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "covers" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeNameClass_pkey" PRIMARY KEY ("normalizedName")
);

-- CreateTable
CREATE TABLE "StandardScopeRequest" (
    "normalizedName" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "projectId" TEXT,
    "personId" INTEGER,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandardScopeRequest_pkey" PRIMARY KEY ("normalizedName")
);

-- Seed the list with every name already in use, so enforcement starts with no
-- gap; scripts/apply-naming-review.ts then trims it to the reviewed list.
INSERT INTO "StandardScope" ("name")
SELECT btrim(n) FROM (
    SELECT "canonicalScope" AS n FROM "ScopeDictionaryEntry"
    UNION SELECT "coarseScope" FROM "ScopeSplitRule"
    UNION SELECT "finerScope" FROM "ScopeSplitRule"
    UNION SELECT "canonicalScope" FROM "TradeDictionaryEntry"
) s
WHERE btrim(n) <> ''
ON CONFLICT DO NOTHING;
