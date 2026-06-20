import { prisma } from "@/lib/db";
import {
  runHealthChecks,
  summarizeHealth,
  computeEnvelope,
  isLeafActive,
  type HealthActivity,
  type HealthIssue,
  type HealthSummary,
  type DateWindow,
} from "@/lib/health/dateChecks";

export interface ScheduleHealth {
  hasImport: boolean;
  asOfDate: Date | null;
  window: DateWindow | null;
  issues: HealthIssue[];
  summary: HealthSummary;
}

/**
 * Read-time schedule health for a project's latest import. Loads the immutable
 * import snapshot and runs the pure date-sanity checks over it — no mutation.
 */
export async function getScheduleHealth(projectId: string): Promise<ScheduleHealth> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  if (!latest) {
    return { hasImport: false, asOfDate: null, window: null, issues: [], summary: summarizeHealth([]) };
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

  const issues = runHealthChecks(activities, env, asOfDate);
  const window = computeEnvelope(activities.filter(isLeafActive), env);
  return { hasImport: true, asOfDate, window, issues, summary: summarizeHealth(issues) };
}
