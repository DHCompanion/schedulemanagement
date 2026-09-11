-- AlterTable
ALTER TABLE "OsProcurementRisk" ADD COLUMN     "atRiskActivityKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
