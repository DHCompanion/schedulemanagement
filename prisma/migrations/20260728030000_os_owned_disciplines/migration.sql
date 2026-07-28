-- DropForeignKey
ALTER TABLE "ProjectTradeAssignment" DROP CONSTRAINT "ProjectTradeAssignment_tradePartnerId_fkey";

-- DropIndex
DROP INDEX "ProjectTradeAssignment_projectId_tradeDiscipline_key";

-- AlterTable
ALTER TABLE "ProjectTradeAssignment" DROP COLUMN "tradeDiscipline",
DROP COLUMN "tradePartnerId",
ADD COLUMN     "osDisciplineId" INTEGER NOT NULL,
ADD COLUMN     "osPartnerId" INTEGER NOT NULL,
ADD COLUMN     "partnerName" TEXT NOT NULL,
ADD COLUMN     "personId" INTEGER;

-- AlterTable
ALTER TABLE "TradeDictionaryEntry" DROP COLUMN "tradeDiscipline",
ADD COLUMN     "disciplineName" TEXT NOT NULL,
ADD COLUMN     "osDisciplineId" INTEGER NOT NULL,
ADD COLUMN     "personId" INTEGER;

-- DropTable
DROP TABLE "TradePartner";

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTradeAssignment_projectId_osDisciplineId_key" ON "ProjectTradeAssignment"("projectId", "osDisciplineId");

