-- CreateTable
CREATE TABLE "ScopeNotCoarse" (
    "normalizedName" TEXT NOT NULL,
    "personId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeNotCoarse_pkey" PRIMARY KEY ("normalizedName")
);
