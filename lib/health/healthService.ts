import { prisma } from "@/lib/db";
import {
  runHealthChecks,
  summarizeHealth,
  summarizeProgress,
  computeEnvelope,
  type HealthActivity,
  type HealthIssue,
  type HealthSummary,
  type DateWindow,
  type ProgressSummary,
} from "@/lib/health/dateChecks";
import { isLeafActive } from "@/lib/msp/types";
import { scoreLogic, type LogicActivity, type LogicRelationship, type LogicScore } from "@/lib/health/logicChecks";
import { classifyImport, isImportTier, type ImportTier } from "@/lib/health/importTier";

const DEFAULT_MINUTES_PER_DAY = 480;

export interface ImportQuality {
  logic: LogicScore;
  tier: ImportTier;
  reasons: string[];
}

export interface ScheduleHealth {
  hasImport: boolean;
  asOfDate: Date | null;
  window: DateWindow | null;
  issues: HealthIssue[];
  summary: HealthSummary;
  progress: ProgressSummary;
  quality: ImportQuality | null;
}

interface QualitySource {
  minutesPerDay: number | null;
  tierOverride: string | null;
  activities: LogicActivity[];
  relationships: LogicRelationship[];
}

export function importQuality(imp: QualitySource): ImportQuality {
  const logic = scoreLogic(imp.activities, imp.relationships, imp.minutesPerDay ?? DEFAULT_MINUTES_PER_DAY);
  const leaves = imp.activities.filter(isLeafActive);
  const leafUids = new Set(leaves.map((a) => a.externalUid));
  const { tier, reasons } = classifyImport({
    leafCount: leaves.length,
    relationshipCount: imp.relationships.filter((r) => leafUids.has(r.predecessorExternalUid) && leafUids.has(r.successorExternalUid)).length,
    leavesWithActuals: leaves.filter((a) => a.actualStart || a.actualFinish).length,
    logic,
  });
  if (isImportTier(imp.tierOverride) && imp.tierOverride !== tier) {
    return { logic, tier: imp.tierOverride, reasons: [`Set to ${imp.tierOverride.replace("_", "-")} in review.`, ...reasons] };
  }
  return { logic, tier, reasons };
}

/** Logic score and tier for one import. Shared by the health page and the backfill report. */
export async function getImportQuality(importId: string): Promise<ImportQuality> {
  const imp = await prisma.scheduleImport.findUniqueOrThrow({
    where: { id: importId },
    include: { activities: true, relationships: true },
  });
  return importQuality(imp);
}

/**
 * Read-time schedule health for a project's latest import. Loads the immutable
 * import snapshot and runs the pure date-sanity checks over it — no mutation.
 */
export async function getScheduleHealth(projectId: string): Promise<ScheduleHealth> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true, relationships: true },
  });
  if (!latest) {
    return { hasImport: false, asOfDate: null, window: null, issues: [], summary: summarizeHealth([]), progress: summarizeProgress([]), quality: null };
  }

  const asOfDate = latest.statusDate ?? latest.importedAt;
  const env = { projectStart: latest.projectStart, projectFinish: latest.projectFinish };
  const activities: HealthActivity[] = latest.activities.map((a) => ({
    id: a.id,
    externalId: a.externalId,
    wbsCode: a.wbsCode,
    name: a.name,
    type: a.type,
    isActive: a.isActive,
    isMilestone: a.isMilestone,
    plannedStart: a.plannedStart,
    plannedFinish: a.plannedFinish,
    actualStart: a.actualStart,
    actualFinish: a.actualFinish,
    percentComplete: a.percentComplete,
  }));

  // Status date is too often stale in MS Project files to judge actuals by; the import date is not.
  const issues = runHealthChecks(activities, env, latest.importedAt);
  const window = computeEnvelope(activities.filter(isLeafActive), env);
  return { hasImport: true, asOfDate, window, issues, summary: summarizeHealth(issues), progress: summarizeProgress(activities), quality: importQuality(latest) };
}
