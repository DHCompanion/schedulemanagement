import { prisma } from "@/lib/db";
import { applyDictionary } from "@/lib/normalize/normalizationService";
import { getSplitRules } from "@/lib/completeness/splitRuleService";
import { checkCompleteness, summarizeCompleteness, type CompletenessIssue, type CompletenessSummary } from "@/lib/completeness/completenessChecks";

export interface ScheduleCompleteness {
  hasImport: boolean;
  issues: CompletenessIssue[];
  summary: CompletenessSummary;
}

function isLeafActive(a: { type: string; isActive: boolean }): boolean {
  return a.type !== "summary" && a.type !== "project_summary" && a.isActive;
}

export async function getCompleteness(projectId: string): Promise<ScheduleCompleteness> {
  const latestImport = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });

  if (!latestImport) {
    return { hasImport: false, issues: [], summary: summarizeCompleteness([]) };
  }

  const leaves = latestImport.activities.filter(isLeafActive);
  const { mapped } = await applyDictionary(leaves);
  const splitRules = await getSplitRules();

  const activities = mapped.map(({ activity, canonicalScope }) => ({
    canonicalActivityKey: activity.canonicalActivityKey,
    externalId: activity.externalId,
    wbsCode: activity.wbsCode,
    name: activity.name,
    canonicalScope,
  }));

  const allIssues = checkCompleteness(activities, splitRules);

  const dismissals = await prisma.completenessDismissal.findMany({ where: { projectId } });
  const dismissedKeys = new Set(dismissals.map((d) => `${d.canonicalActivityKey}::${d.coarseScope}`));

  const issues = allIssues.filter((i) => !dismissedKeys.has(`${i.canonicalActivityKey}::${i.coarseScope}`));

  return { hasImport: true, issues, summary: summarizeCompleteness(issues) };
}

export async function dismissIssue(
  projectId: string,
  canonicalActivityKey: string,
  coarseScope: string,
  dismissedBy?: string,
  note?: string,
): Promise<void> {
  await prisma.completenessDismissal.upsert({
    where: { projectId_canonicalActivityKey_coarseScope: { projectId, canonicalActivityKey, coarseScope } },
    create: { projectId, canonicalActivityKey, coarseScope, dismissedBy, note },
    update: { dismissedBy, note },
  });
}
