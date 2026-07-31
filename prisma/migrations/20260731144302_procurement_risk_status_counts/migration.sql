/*
  Warnings:

  - You are about to drop the column `atRiskCount` on the `OsProcurementRisk` table. All the data in the column will be lost.
  - You are about to drop the column `openVarianceCount` on the `OsProcurementRisk` table. All the data in the column will be lost.
  - Added the required column `behindCount` to the `OsProcurementRisk` table without a default value. This is not possible if the table is not empty.
  - Added the required column `missingDatesCount` to the `OsProcurementRisk` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectedLateCount` to the `OsProcurementRisk` table without a default value. This is not possible if the table is not empty.
  - Added the required column `releasedAtRiskCount` to the `OsProcurementRisk` table without a default value. This is not possible if the table is not empty.
  - Added the required column `submittalLateCount` to the `OsProcurementRisk` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "OsProcurementRisk" DROP COLUMN "atRiskCount",
DROP COLUMN "openVarianceCount",
ADD COLUMN     "behindCount" INTEGER NOT NULL,
ADD COLUMN     "missingDatesCount" INTEGER NOT NULL,
ADD COLUMN     "projectedLateCount" INTEGER NOT NULL,
ADD COLUMN     "releasedAtRiskCount" INTEGER NOT NULL,
ADD COLUMN     "submittalLateCount" INTEGER NOT NULL;
