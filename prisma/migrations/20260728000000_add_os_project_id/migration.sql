-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "osProjectId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Project_osProjectId_key" ON "Project"("osProjectId");

