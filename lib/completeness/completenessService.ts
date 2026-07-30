import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { getSplitRules } from "@/lib/completeness/splitRuleService";
import { checkCompleteness, summarizeCompleteness, type CompletenessIssue, type CompletenessSummary } from "@/lib/completeness/completenessChecks";
import { isLeafActive } from "@/lib/msp/types";

/** A distinct activity name in the schedule, and whether it is already marked coarse. */
export interface ScheduleName {
  name: string;
  count: number;
  finerScopes: string[];
}

export interface ScheduleCompleteness {
  hasImport: boolean;
  issues: CompletenessIssue[];
  summary: CompletenessSummary;
  names: ScheduleName[];
}

export async function getCompleteness(projectId: string): Promise<ScheduleCompleteness> {
  const latestImport = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });

  if (!latestImport) {
    return { hasImport: false, issues: [], summary: summarizeCompleteness([]), names: [] };
  }

  const leaves = latestImport.activities.filter(isLeafActive);
  const splitRules = await getSplitRules();
  const allIssues = checkCompleteness(leaves, splitRules);

  const dismissals = await prisma.completenessDismissal.findMany({ where: { projectId } });
  const dismissedKeys = new Set(dismissals.map((d) => `${d.canonicalActivityKey}::${d.coarseScope}`));

  const issues = allIssues.filter((i) => !dismissedKeys.has(`${i.canonicalActivityKey}::${i.coarseScope}`));

  // The population the coarse-marking UI offers: every distinct name in the
  // schedule, commonest first, carrying any rule already on it.
  const rulesByName = new Map([...splitRules].map(([coarse, finer]) => [normalizeName(coarse), finer]));
  const counts = new Map<string, { name: string; count: number }>();
  for (const a of leaves) {
    const key = normalizeName(a.name);
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { name: a.name.trim(), count: 1 });
  }
  const names: ScheduleName[] = [...counts.entries()]
    .map(([key, { name, count }]) => ({ name, count, finerScopes: rulesByName.get(key) ?? [] }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { hasImport: true, issues, summary: summarizeCompleteness(issues), names };
}

export async function dismissIssue(
  projectId: string,
  canonicalActivityKey: string,
  coarseScope: string,
  dismissedBy?: string,
  note?: string,
  personId?: number | null,
): Promise<void> {
  await prisma.completenessDismissal.upsert({
    where: { projectId_canonicalActivityKey_coarseScope: { projectId, canonicalActivityKey, coarseScope } },
    create: { projectId, canonicalActivityKey, coarseScope, dismissedBy, note, personId: personId ?? null },
    update: { dismissedBy, note, personId: personId ?? null },
  });
}
