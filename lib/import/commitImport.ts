import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseMspXml } from "@/lib/msp/parseMspXml";
import type { ParsedSchedule } from "@/lib/msp/types";

/** MSPDI datetimes are naive local; store wall-clock deterministically as UTC. */
export function toDbDate(s: string | null): Date | null {
  if (!s) return null;
  const hasTz = /[zZ]|[+-]\d\d:\d\d$/.test(s);
  return new Date(hasTz ? s : `${s}Z`);
}

export function previewImport(xml: string): { parsed: ParsedSchedule; fileHash: string; suggestedIsBaseline: boolean } {
  const parsed = parseMspXml(xml);
  const fileHash = crypto.createHash("sha256").update(xml).digest("hex");
  const hasAnyBaseline = parsed.activities.some((a) => a.baselineStart || a.baselineFinish);
  return { parsed, fileHash, suggestedIsBaseline: !hasAnyBaseline };
}

export interface CommitOptions {
  projectId: string;
  fileName: string;
  xml: string;
  statusDateOverride?: string | null;
  importedBy?: string | null;
  isBaseline?: boolean;
}

export async function commitImport(opts: CommitOptions): Promise<{ id: string }> {
  const { parsed, fileHash, suggestedIsBaseline } = previewImport(opts.xml);
  const statusDate = opts.statusDateOverride ?? parsed.header.statusDate;
  const isBaseline = opts.isBaseline ?? suggestedIsBaseline;

  const imp = await prisma.$transaction(async (tx) => {
    const created = await tx.scheduleImport.create({
      data: {
        projectId: opts.projectId,
        sourceFormat: "msproject_xml",
        fileName: opts.fileName,
        fileHash,
        importedBy: opts.importedBy ?? null,
        projectTitleFromFile: parsed.header.titleFromFile,
        statusDate: toDbDate(statusDate),
        isBaseline,
        projectStart: toDbDate(parsed.header.projectStart),
        projectFinish: toDbDate(parsed.header.projectFinish),
        minutesPerDay: parsed.header.minutesPerDay,
        minutesPerWeek: parsed.header.minutesPerWeek,
        daysPerMonth: parsed.header.daysPerMonth,
        rawProjectProps: parsed.header.rawProps as Prisma.InputJsonValue,
        importFieldDefinitions: parsed.fieldDefinitions as unknown as Prisma.InputJsonValue,
        activityCount: parsed.counts.activities,
        relationshipCount: parsed.counts.relationships,
        resourceCount: parsed.counts.resources,
        warnings: parsed.warnings as Prisma.InputJsonValue,
      },
    });

    if (parsed.activities.length) {
      await tx.activity.createMany({
        data: parsed.activities.map((a) => ({
          scheduleImportId: created.id,
          externalUid: a.externalUid,
          externalGuid: a.externalGuid,
          externalId: a.externalId,
          wbsCode: a.wbsCode,
          outlineNumber: a.outlineNumber,
          outlineLevel: a.outlineLevel,
          parentExternalUid: a.parentExternalUid,
          name: a.name,
          canonicalActivityKey: a.canonicalActivityKey,
          type: a.type,
          rawType: a.rawType,
          isMilestone: a.isMilestone,
          isSummary: a.isSummary,
          isProjectSummary: a.isProjectSummary,
          isCritical: a.isCritical,
          isActive: a.isActive,
          plannedStart: toDbDate(a.plannedStart),
          plannedFinish: toDbDate(a.plannedFinish),
          earlyStart: toDbDate(a.earlyStart),
          earlyFinish: toDbDate(a.earlyFinish),
          lateStart: toDbDate(a.lateStart),
          lateFinish: toDbDate(a.lateFinish),
          actualStart: toDbDate(a.actualStart),
          actualFinish: toDbDate(a.actualFinish),
          baselineStart: toDbDate(a.baselineStart),
          baselineFinish: toDbDate(a.baselineFinish),
          baselineDurationMinutes: a.baselineDurationMinutes,
          durationMinutes: a.durationMinutes,
          durationDays: a.durationDays,
          remainingDurationMinutes: a.remainingDurationMinutes,
          actualDurationMinutes: a.actualDurationMinutes,
          percentComplete: a.percentComplete,
          percentWorkComplete: a.percentWorkComplete,
          totalSlackMinutes: a.totalSlackMinutes,
          freeSlackMinutes: a.freeSlackMinutes,
          constraintType: a.constraintType,
          constraintDate: toDbDate(a.constraintDate),
          deadline: toDbDate(a.deadline),
          calendarExternalUid: a.calendarExternalUid,
          customFields: a.customFields as Prisma.InputJsonValue,
          rawBaselines: a.rawBaselines as Prisma.InputJsonValue,
        })),
      });
    }

    if (parsed.relationships.length) {
      await tx.relationship.createMany({
        data: parsed.relationships.map((r) => ({
          scheduleImportId: created.id,
          predecessorExternalUid: r.predecessorExternalUid,
          successorExternalUid: r.successorExternalUid,
          type: r.type,
          rawType: r.rawType,
          lagMinutes: r.lagMinutes,
          rawLagFormat: r.rawLagFormat,
          crossProject: r.crossProject,
        })),
      });
    }

    if (parsed.resources.length) {
      await tx.resource.createMany({
        data: parsed.resources.map((r) => ({
          scheduleImportId: created.id,
          externalUid: r.externalUid,
          name: r.name,
          type: r.type,
          group: r.group,
          customFields: r.customFields as Prisma.InputJsonValue,
        })),
      });
    }

    if (parsed.assignments.length) {
      await tx.assignment.createMany({
        data: parsed.assignments.map((a) => ({
          scheduleImportId: created.id,
          activityExternalUid: a.activityExternalUid,
          resourceExternalUid: a.resourceExternalUid,
          units: a.units,
          workMinutes: a.workMinutes,
        })),
      });
    }

    if (parsed.calendars.length) {
      await tx.calendar.createMany({
        data: parsed.calendars.map((c) => ({
          scheduleImportId: created.id,
          externalUid: c.externalUid,
          name: c.name,
          raw: c.raw as Prisma.InputJsonValue,
        })),
      });
    }

    return created;
  });

  return { id: imp.id };
}
