-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client" TEXT,
    "sector" TEXT,
    "buildingType" TEXT,
    "sizeSqFt" INTEGER,
    "contractValue" DECIMAL(14,2),
    "region" TEXT,
    "deliveryMethod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "externalProjectKey" TEXT,
    "externalProjectGuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleImport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedBy" TEXT,
    "projectTitleFromFile" TEXT,
    "statusDate" TIMESTAMP(3),
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "projectStart" TIMESTAMP(3),
    "projectFinish" TIMESTAMP(3),
    "minutesPerDay" INTEGER,
    "minutesPerWeek" INTEGER,
    "daysPerMonth" INTEGER,
    "rawProjectProps" JSONB,
    "importFieldDefinitions" JSONB,
    "activityCount" INTEGER NOT NULL DEFAULT 0,
    "relationshipCount" INTEGER NOT NULL DEFAULT 0,
    "resourceCount" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "notes" TEXT,

    CONSTRAINT "ScheduleImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "scheduleImportId" TEXT NOT NULL,
    "externalUid" INTEGER NOT NULL,
    "externalGuid" TEXT,
    "externalId" INTEGER,
    "wbsCode" TEXT,
    "outlineNumber" TEXT,
    "outlineLevel" INTEGER NOT NULL DEFAULT 0,
    "parentExternalUid" INTEGER,
    "name" TEXT NOT NULL,
    "canonicalActivityKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "rawType" TEXT,
    "isMilestone" BOOLEAN NOT NULL DEFAULT false,
    "isSummary" BOOLEAN NOT NULL DEFAULT false,
    "isProjectSummary" BOOLEAN NOT NULL DEFAULT false,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "plannedStart" TIMESTAMP(3),
    "plannedFinish" TIMESTAMP(3),
    "earlyStart" TIMESTAMP(3),
    "earlyFinish" TIMESTAMP(3),
    "lateStart" TIMESTAMP(3),
    "lateFinish" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualFinish" TIMESTAMP(3),
    "baselineStart" TIMESTAMP(3),
    "baselineFinish" TIMESTAMP(3),
    "baselineDurationMinutes" DOUBLE PRECISION,
    "durationMinutes" DOUBLE PRECISION,
    "durationDays" DOUBLE PRECISION,
    "remainingDurationMinutes" DOUBLE PRECISION,
    "actualDurationMinutes" DOUBLE PRECISION,
    "percentComplete" INTEGER,
    "percentWorkComplete" INTEGER,
    "totalSlackMinutes" DOUBLE PRECISION,
    "freeSlackMinutes" DOUBLE PRECISION,
    "constraintType" INTEGER,
    "constraintDate" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "calendarExternalUid" INTEGER,
    "customFields" JSONB,
    "rawBaselines" JSONB,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL,
    "scheduleImportId" TEXT NOT NULL,
    "predecessorExternalUid" INTEGER NOT NULL,
    "successorExternalUid" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "rawType" TEXT,
    "lagMinutes" DOUBLE PRECISION,
    "rawLagFormat" TEXT,
    "crossProject" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "scheduleImportId" TEXT NOT NULL,
    "externalUid" INTEGER NOT NULL,
    "name" TEXT,
    "type" TEXT,
    "group" TEXT,
    "customFields" JSONB,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "scheduleImportId" TEXT NOT NULL,
    "activityExternalUid" INTEGER NOT NULL,
    "resourceExternalUid" INTEGER NOT NULL,
    "units" DOUBLE PRECISION,
    "workMinutes" DOUBLE PRECISION,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calendar" (
    "id" TEXT NOT NULL,
    "scheduleImportId" TEXT NOT NULL,
    "externalUid" INTEGER NOT NULL,
    "name" TEXT,
    "raw" JSONB,

    CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduleImport_projectId_idx" ON "ScheduleImport"("projectId");

-- CreateIndex
CREATE INDEX "Activity_scheduleImportId_idx" ON "Activity"("scheduleImportId");

-- CreateIndex
CREATE INDEX "Activity_scheduleImportId_externalUid_idx" ON "Activity"("scheduleImportId", "externalUid");

-- CreateIndex
CREATE INDEX "Activity_scheduleImportId_wbsCode_idx" ON "Activity"("scheduleImportId", "wbsCode");

-- CreateIndex
CREATE INDEX "Activity_scheduleImportId_plannedStart_idx" ON "Activity"("scheduleImportId", "plannedStart");

-- CreateIndex
CREATE INDEX "Relationship_scheduleImportId_idx" ON "Relationship"("scheduleImportId");

-- CreateIndex
CREATE INDEX "Resource_scheduleImportId_idx" ON "Resource"("scheduleImportId");

-- CreateIndex
CREATE INDEX "Assignment_scheduleImportId_idx" ON "Assignment"("scheduleImportId");

-- CreateIndex
CREATE INDEX "Calendar_scheduleImportId_idx" ON "Calendar"("scheduleImportId");

-- AddForeignKey
ALTER TABLE "ScheduleImport" ADD CONSTRAINT "ScheduleImport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_scheduleImportId_fkey" FOREIGN KEY ("scheduleImportId") REFERENCES "ScheduleImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_scheduleImportId_fkey" FOREIGN KEY ("scheduleImportId") REFERENCES "ScheduleImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_scheduleImportId_fkey" FOREIGN KEY ("scheduleImportId") REFERENCES "ScheduleImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_scheduleImportId_fkey" FOREIGN KEY ("scheduleImportId") REFERENCES "ScheduleImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_scheduleImportId_fkey" FOREIGN KEY ("scheduleImportId") REFERENCES "ScheduleImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

