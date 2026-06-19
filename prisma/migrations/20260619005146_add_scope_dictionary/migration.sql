-- CreateTable
CREATE TABLE "ScopeDictionaryEntry" (
    "id" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "canonicalScope" TEXT NOT NULL,
    "timesConfirmed" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeDictionaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScopeDictionaryEntry_normalizedName_key" ON "ScopeDictionaryEntry"("normalizedName");

