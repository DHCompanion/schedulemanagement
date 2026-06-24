-- CreateTable
CREATE TABLE "TradeScopeDismissal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "canonicalScope" TEXT NOT NULL,
    "dismissedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeScopeDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeScopeDismissal_projectId_idx" ON "TradeScopeDismissal"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeScopeDismissal_projectId_canonicalScope_key" ON "TradeScopeDismissal"("projectId", "canonicalScope");

-- AddForeignKey
ALTER TABLE "TradeScopeDismissal" ADD CONSTRAINT "TradeScopeDismissal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
