import { Prisma, type ScheduleImport, type CompletenessSplit } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canonicalActivityKey as buildCanonicalActivityKey } from "@/lib/msp/canonicalKey";
import { getSplitRules } from "@/lib/completeness/splitRuleService";

export async function acceptSplit(
  projectId: string,
  canonicalActivityKey: string,
  coarseScope: string,
  acceptedBy?: string,
): Promise<{ newImportId: string }> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true, relationships: true },
  });
  if (!latest) throw new Error("No imported schedule to split.");

  const coarse = latest.activities.find((a) => a.canonicalActivityKey === canonicalActivityKey);
  if (!coarse) throw new Error("Activity not found in the latest import.");

  const splitRules = await getSplitRules();
  const finerScopes = splitRules.get(coarseScope);
  if (!finerScopes || finerScopes.length === 0) throw new Error("No split rule found for this coarse scope.");

  const { _max } = await prisma.activity.aggregate({
    where: { scheduleImport: { projectId } },
    _max: { externalUid: true },
  });
  const startUid = (_max.externalUid ?? 0) + 1;
  const mintedUids = finerScopes.map((_, i) => startUid + i);

  const newImportId = await prisma.$transaction(async (tx) => {
    const created = await tx.scheduleImport.create({
      data: {
        projectId,
        sourceFormat: latest.sourceFormat,
        fileName: latest.fileName,
        fileHash: latest.fileHash,
        statusDate: latest.statusDate,
        projectStart: latest.projectStart,
        projectFinish: latest.projectFinish,
        minutesPerDay: latest.minutesPerDay,
        minutesPerWeek: latest.minutesPerWeek,
        daysPerMonth: latest.daysPerMonth,
        isSynthetic: true,
        derivedFromImportId: latest.id,
        notes: `Split "${coarse.name}" into: ${finerScopes.join(", ")}`,
      },
    });

    const otherActivities = latest.activities.filter((a) => a.id !== coarse.id);
    if (otherActivities.length) {
      await tx.activity.createMany({
        data: otherActivities.map((a) => ({
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
          plannedStart: a.plannedStart,
          plannedFinish: a.plannedFinish,
          earlyStart: a.earlyStart,
          earlyFinish: a.earlyFinish,
          lateStart: a.lateStart,
          lateFinish: a.lateFinish,
          actualStart: a.actualStart,
          actualFinish: a.actualFinish,
          baselineStart: a.baselineStart,
          baselineFinish: a.baselineFinish,
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
          constraintDate: a.constraintDate,
          deadline: a.deadline,
          calendarExternalUid: a.calendarExternalUid,
          customFields: a.customFields === null ? Prisma.JsonNull : (a.customFields as Prisma.InputJsonValue),
          rawBaselines: a.rawBaselines === null ? Prisma.JsonNull : (a.rawBaselines as Prisma.InputJsonValue),
        })),
      });
    }

    await tx.activity.createMany({
      data: finerScopes.map((scope, i) => {
        const wbsCode = coarse.wbsCode ? `${coarse.wbsCode}.${i + 1}` : null;
        return {
          scheduleImportId: created.id,
          externalUid: mintedUids[i],
          externalId: mintedUids[i],
          wbsCode,
          outlineNumber: coarse.outlineNumber ? `${coarse.outlineNumber}.${i + 1}` : null,
          outlineLevel: coarse.outlineLevel,
          parentExternalUid: coarse.parentExternalUid,
          name: scope,
          canonicalActivityKey: buildCanonicalActivityKey(wbsCode, scope),
          type: coarse.type,
          isMilestone: coarse.isMilestone,
          isSummary: false,
          isProjectSummary: false,
          isCritical: false,
          isActive: true,
          plannedStart: coarse.plannedStart,
          plannedFinish: coarse.plannedFinish,
          durationMinutes: coarse.durationMinutes,
          durationDays: coarse.durationDays,
          remainingDurationMinutes: coarse.durationMinutes,
          percentComplete: 0,
          calendarExternalUid: coarse.calendarExternalUid,
        };
      }),
    });

    const otherRelationships = latest.relationships.filter(
      (r) => r.predecessorExternalUid !== coarse.externalUid && r.successorExternalUid !== coarse.externalUid,
    );
    if (otherRelationships.length) {
      await tx.relationship.createMany({
        data: otherRelationships.map((r) => ({
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

    const fanned: Prisma.RelationshipCreateManyInput[] = [];
    for (const r of latest.relationships.filter((r) => r.predecessorExternalUid === coarse.externalUid)) {
      for (const uid of mintedUids) {
        fanned.push({
          scheduleImportId: created.id,
          predecessorExternalUid: uid,
          successorExternalUid: r.successorExternalUid,
          type: r.type,
          rawType: r.rawType,
          lagMinutes: r.lagMinutes,
          rawLagFormat: r.rawLagFormat,
          crossProject: r.crossProject,
        });
      }
    }
    for (const r of latest.relationships.filter((r) => r.successorExternalUid === coarse.externalUid)) {
      for (const uid of mintedUids) {
        fanned.push({
          scheduleImportId: created.id,
          predecessorExternalUid: r.predecessorExternalUid,
          successorExternalUid: uid,
          type: r.type,
          rawType: r.rawType,
          lagMinutes: r.lagMinutes,
          rawLagFormat: r.rawLagFormat,
          crossProject: r.crossProject,
        });
      }
    }
    if (fanned.length) await tx.relationship.createMany({ data: fanned });

    await tx.scheduleImport.update({
      where: { id: created.id },
      data: {
        activityCount: otherActivities.length + finerScopes.length,
        relationshipCount: otherRelationships.length + fanned.length,
      },
    });

    await tx.completenessSplit.create({
      data: {
        projectId,
        sourceScheduleImportId: latest.id,
        resultScheduleImportId: created.id,
        coarseExternalUid: coarse.externalUid,
        coarseWbsCode: coarse.wbsCode,
        coarseOutlineNumber: coarse.outlineNumber,
        coarseOutlineLevel: coarse.outlineLevel,
        coarseName: coarse.name,
        coarseDurationMinutes: coarse.durationMinutes,
        coarseStart: coarse.plannedStart,
        coarseFinish: coarse.plannedFinish,
        finerScopes: finerScopes as Prisma.InputJsonValue,
        mintedUids: mintedUids as Prisma.InputJsonValue,
        acceptedBy: acceptedBy ?? null,
      },
    });

    return created.id;
  });

  return { newImportId };
}

/** Walk a (possibly synthetic) latest import back to its nearest real ancestor, collecting every CompletenessSplit along the way, oldest first. */
export async function resolveExportBase(
  latestImportId: string,
): Promise<{ baseImport: ScheduleImport; splits: CompletenessSplit[] }> {
  const splits: CompletenessSplit[] = [];
  let current = await prisma.scheduleImport.findUniqueOrThrow({ where: { id: latestImportId } });
  while (current.isSynthetic) {
    const split = await prisma.completenessSplit.findUnique({ where: { resultScheduleImportId: current.id } });
    if (!split) break;
    splits.unshift(split);
    if (!current.derivedFromImportId) break;
    current = await prisma.scheduleImport.findUniqueOrThrow({ where: { id: current.derivedFromImportId } });
  }
  return { baseImport: current, splits };
}
