-- CreateTable
CREATE TABLE "ScopeIgnoredName" (
    "normalizedName" TEXT NOT NULL,
    "personId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScopeIgnoredName_pkey" PRIMARY KEY ("normalizedName")
);
