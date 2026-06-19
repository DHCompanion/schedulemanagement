-- CreateTable
CREATE TABLE "TradeDictionaryEntry" (
    "id" TEXT NOT NULL,
    "canonicalScope" TEXT NOT NULL,
    "tradeDiscipline" TEXT NOT NULL,
    "timesConfirmed" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeDictionaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradePartner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradePartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTradeAssignment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tradeDiscipline" TEXT NOT NULL,
    "tradePartnerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTradeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradeDictionaryEntry_canonicalScope_key" ON "TradeDictionaryEntry"("canonicalScope");

-- CreateIndex
CREATE UNIQUE INDEX "TradePartner_name_key" ON "TradePartner"("name");

-- CreateIndex
CREATE INDEX "ProjectTradeAssignment_projectId_idx" ON "ProjectTradeAssignment"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTradeAssignment_projectId_tradeDiscipline_key" ON "ProjectTradeAssignment"("projectId", "tradeDiscipline");

-- AddForeignKey
ALTER TABLE "ProjectTradeAssignment" ADD CONSTRAINT "ProjectTradeAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTradeAssignment" ADD CONSTRAINT "ProjectTradeAssignment_tradePartnerId_fkey" FOREIGN KEY ("tradePartnerId") REFERENCES "TradePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

