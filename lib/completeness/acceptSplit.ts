import { Prisma, type ScheduleImport, type CompletenessSplit } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canonicalActivityKey as buildCanonicalActivityKey } from "@/lib/msp/canonicalKey";
import { getSplitRules } from "@/lib/completeness/splitRuleService";
import { getCompleteness } from "@/lib/completeness/completenessService";

export async function acceptSplit(
  projectId: string,
  coarseScope: string,
  acceptedBy?: string,
  personId?: number | null,
): Promise<{ newImportId: string; splitCount: number }> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true, relationships: true },
  });
  if (!latest) throw new Error("No imported schedule to split.");

  const splitRules = await getSplitRules();
  const finerScopes = splitRules.get(coarseScope);
  if (!finerScopes || finerScopes.length === 0) throw new Error("No split rule found for this coarse scope.");

  // Reuse the completeness read so dismissals are honoured by exactly the rule
  // that flagged these in the first place — a second copy of that filter here
  // would drift from it.
  const { issues } = await getCompleteness(projectId);
  const targetKeys = new Set(issues.filter((i) => i.coarseScope === coarseScope).map((i) => i.canonicalActivityKey));
  const coarseActivities = latest.activities.filter((a) => targetKeys.has(a.canonicalActivityKey));
  if (coarseActivities.length === 0) throw new Error("Nothing left to split for this coarse scope.");

  const coarseIds = new Set(coarseActivities.map((a) => a.id));
  const coarseUids = new Set(coarseActivities.map((a) => a.externalUid));

  const { _max } = await prisma.activity.aggregate({
    where: { scheduleImport: { projectId } },
    _max: { externalUid: true },
  });
  let nextUid = (_max.externalUid ?? 0) + 1;
  const mintedByActivityId = new Map<string, number[]>();
  for (const coarse of coarseActivities) {
    mintedByActivityId.set(coarse.id, finerScopes.map(() => nextUid++));
  }

  const newImportId = await prisma.$transaction(async (tx) => {
    const created = await tx.scheduleImport.create({
      data: {
        projectId,
        sourceFormat: latest.sourceFormat,
        fileName: latest.fileName,
        fileHash: latest.fileHash,
        personId: personId ?? null,
        statusDate: latest.statusDate,
        projectStart: latest.projectStart,
        projectFinish: latest.projectFinish,
        minutesPerDay: latest.minutesPerDay,
        minutesPerWeek: latest.minutesPerWeek,
        daysPerMonth: latest.daysPerMonth,
        isSynthetic: true,
        derivedFromImportId: latest.id,
        notes: `Split ${coarseActivities.length} × "${coarseScope}" into: ${finerScopes.join(", ")}`,
      },
    });

    const otherActivities = latest.activities.filter((a) => !coarseIds.has(a.id));
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

    const otherRelationships = latest.relationships.filter(
      (r) => !coarseUids.has(r.predecessorExternalUid) && !coarseUids.has(r.successorExternalUid),
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

    // A relationship with both ends in the batch must fan to the cross-product
    // of the two minted UID sets — every one of the predecessor's replacements
    // to every one of the successor's — not just one side, or the other end
    // would still point at an activity that no longer exists in this import.
    const mintedUidsByExternalUid = new Map<number, number[]>();
    for (const coarse of coarseActivities) {
      mintedUidsByExternalUid.set(coarse.externalUid, mintedByActivityId.get(coarse.id)!);
    }

    const fanned: Prisma.RelationshipCreateManyInput[] = [];
    for (const r of latest.relationships) {
      const predMinted = mintedUidsByExternalUid.get(r.predecessorExternalUid);
      const succMinted = mintedUidsByExternalUid.get(r.successorExternalUid);
      if (!predMinted && !succMinted) continue; // neither end touched — already in otherRelationships

      const base = {
        scheduleImportId: created.id,
        type: r.type,
        rawType: r.rawType,
        lagMinutes: r.lagMinutes,
        rawLagFormat: r.rawLagFormat,
        crossProject: r.crossProject,
      };
      if (predMinted && succMinted) {
        for (const p of predMinted) {
          for (const s of succMinted) {
            fanned.push({ ...base, predecessorExternalUid: p, successorExternalUid: s });
          }
        }
      } else if (predMinted) {
        for (const p of predMinted) {
          fanned.push({ ...base, predecessorExternalUid: p, successorExternalUid: r.successorExternalUid });
        }
      } else if (succMinted) {
        for (const s of succMinted) {
          fanned.push({ ...base, predecessorExternalUid: r.predecessorExternalUid, successorExternalUid: s });
        }
      }
    }

    const finerRows: Prisma.ActivityCreateManyInput[] = [];
    const splitRows: Prisma.CompletenessSplitCreateManyInput[] = [];

    for (const coarse of coarseActivities) {
      const mintedUids = mintedByActivityId.get(coarse.id)!;

      finerRows.push(
        ...finerScopes.map((scope, i) => {
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
      );

      splitRows.push({
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
        personId: personId ?? null,
      });
    }

    await tx.activity.createMany({ data: finerRows });
    if (fanned.length) await tx.relationship.createMany({ data: fanned });
    await tx.completenessSplit.createMany({ data: splitRows });

    await tx.scheduleImport.update({
      where: { id: created.id },
      data: {
        activityCount: otherActivities.length + finerRows.length,
        relationshipCount: otherRelationships.length + fanned.length,
      },
    });

    return created.id;
  });

  return { newImportId, splitCount: coarseActivities.length };
}

/** Walk a (possibly synthetic) latest import back to its nearest real ancestor, collecting every CompletenessSplit along the way, oldest first. */
export async function resolveExportBase(
  latestImportId: string,
): Promise<{ baseImport: ScheduleImport; splits: CompletenessSplit[] }> {
  const splits: CompletenessSplit[] = [];
  let current = await prisma.scheduleImport.findUniqueOrThrow({ where: { id: latestImportId } });
  while (current.isSynthetic) {
    // Many splits can share one synthetic import — a batch accept records one
    // row per coarse activity it replaced. Ordered so the export applies them
    // deterministically.
    const batch = await prisma.completenessSplit.findMany({
      where: { resultScheduleImportId: current.id },
      orderBy: { coarseExternalUid: "asc" },
    });
    if (batch.length === 0) break;
    splits.unshift(...batch);
    if (!current.derivedFromImportId) break;
    current = await prisma.scheduleImport.findUniqueOrThrow({ where: { id: current.derivedFromImportId } });
  }
  return { baseImport: current, splits };
}
