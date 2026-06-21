-- CreateTable
CREATE TABLE "ScopeSplitRule" (
    "id" TEXT NOT NULL,
    "coarseScope" TEXT NOT NULL,
    "finerScope" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeSplitRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompletenessDismissal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "canonicalActivityKey" TEXT NOT NULL,
    "coarseScope" TEXT NOT NULL,
    "dismissedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletenessDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScopeSplitRule_coarseScope_idx" ON "ScopeSplitRule"("coarseScope");

-- CreateIndex
CREATE UNIQUE INDEX "ScopeSplitRule_coarseScope_finerScope_key" ON "ScopeSplitRule"("coarseScope", "finerScope");

-- CreateIndex
CREATE INDEX "CompletenessDismissal_projectId_idx" ON "CompletenessDismissal"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CompletenessDismissal_projectId_canonicalActivityKey_coarse_key" ON "CompletenessDismissal"("projectId", "canonicalActivityKey", "coarseScope");

-- AddForeignKey
ALTER TABLE "CompletenessDismissal" ADD CONSTRAINT "CompletenessDismissal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
