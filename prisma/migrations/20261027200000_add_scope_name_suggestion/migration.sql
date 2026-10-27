-- Additive: the name review backlog's suggestions. Reverse: DROP TABLE "ScopeNameSuggestion".
-- CreateTable
CREATE TABLE "ScopeNameSuggestion" (
    "normalizedName" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "taskCount" INTEGER NOT NULL,
    "projectCount" INTEGER NOT NULL,
    "samples" JSONB NOT NULL,
    "kind" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL DEFAULT '',
    "covers" TEXT[],
    "confidence" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "poolTasks" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeNameSuggestion_pkey" PRIMARY KEY ("normalizedName")
);

