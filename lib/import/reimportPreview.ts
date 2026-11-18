// What a new file loses or redoes against a project's existing schedule: coarse
// scopes this project split before (re-split after commit), names nobody has
// reviewed yet, and finalized progress whose activity key the file no longer has.
// Read-only; the preview route shows it before the commit.

import { prisma } from "@/lib/db";
import { checkCompleteness, summarizeCompleteness, type CompletenessActivity } from "@/lib/completeness/completenessChecks";
import { getCompletenessRules } from "@/lib/completeness/splitRuleService";
import { getDictionary, getNameStatus } from "@/lib/normalize/normalizationService";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { finerActivityKey } from "@/lib/msp/canonicalKey";
import { isLeafActive } from "@/lib/msp/types";
import { acceptSplit } from "@/lib/completeness/acceptSplit";
import { getCompleteness } from "@/lib/completeness/completenessService";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";

type IncomingActivity = CompletenessActivity & { type: string; isActive: boolean };

export interface ReimportInput {
  activities: IncomingActivity[];
  splitRules: Map<string, string[]>;
  dictionary: Map<string, string>;
  settledNames: Set<string>;
  progressKeys: Iterable<string>;
  /** Raw names of coarse activities this project has split before. */
  previousSplitNames: string[];
  /** `${canonicalActivityKey}::${coarseScope}` of the project's completeness dismissals. */
  dismissed?: Set<string>;
}

export interface ReimportSummary {
  resplit: { coarseScope: string; count: number }[];
  newNames: string[];
  /** Progress lost whatever is chosen. */
  orphanedProgress: string[];
  /** Progress found again only if the splits are re-applied. */
  progressNeedingResplit: string[];
}

export function summarizeReimport(input: ReimportInput): ReimportSummary {
  const { splitRules, dictionary } = input;
  const leaves = input.activities.filter(isLeafActive);

  const splitBefore = splitScopes(input.previousSplitNames, splitRules, dictionary);
  // Same filter the commit's re-split gets through getCompleteness: a dismissed activity stays coarse.
  const resplitIssues = checkCompleteness(leaves, splitRules, dictionary)
    .filter((i) => splitBefore.has(i.coarseScope) && !input.dismissed?.has(`${i.canonicalActivityKey}::${i.coarseScope}`));

  const newNames = new Map<string, string>();
  for (const a of leaves) {
    const key = normalizeName(a.name);
    if (!dictionary.has(key) && !input.settledNames.has(key) && !newNames.has(key)) newNames.set(key, a.name.trim());
  }

  const keys = new Set(input.activities.map((a) => a.canonicalActivityKey));
  const minted = new Set(resplitIssues.flatMap((i) => i.finerScopes.map((scope, n) => finerActivityKey(i.wbsCode, scope, n))));
  const missing = [...input.progressKeys].filter((k) => !keys.has(k));

  return {
    resplit: summarizeCompleteness(resplitIssues).byCoarseScope,
    newNames: [...newNames.values()],
    orphanedProgress: missing.filter((k) => !minted.has(k)),
    progressNeedingResplit: missing.filter((k) => minted.has(k)),
  };
}

/** The coarse scopes, by the rules' spelling, that these raw split names fall under. */
function splitScopes(names: string[], splitRules: Map<string, string[]>, dictionary: Map<string, string>): Set<string> {
  const asActivity = (name: string) => ({ name, canonicalActivityKey: "", externalId: null, wbsCode: null });
  return new Set(checkCompleteness(names.map(asActivity), splitRules, dictionary).map((i) => i.coarseScope));
}

/** Raw names of the coarse activities this project has split before. */
async function previousSplitNames(projectId: string): Promise<string[]> {
  const splits = await prisma.completenessSplit.findMany({ where: { projectId }, select: { coarseName: true }, distinct: ["coarseName"] });
  return splits.map((s) => s.coarseName);
}

/** Null when the project has no schedule yet — a first import has nothing to compare. */
export async function getReimportPreview(projectId: string, activities: IncomingActivity[]): Promise<ReimportSummary | null> {
  const current = await prisma.scheduleImport.findFirst({
    where: { projectId }, orderBy: { importedAt: "desc" }, select: { activities: { select: { canonicalActivityKey: true } } },
  });
  if (!current) return null;
  // Only progress on the current schedule can be lost; keys a split already
  // replaced (getFinalizedEntries keeps the coarse one) are not this import's loss.
  const onSchedule = new Set(current.activities.map((a) => a.canonicalActivityKey));
  const [splitRules, dictionary, status, entries, splitNames, dismissals] = await Promise.all([
    getCompletenessRules(), getDictionary(), getNameStatus(), getFinalizedEntries(projectId), previousSplitNames(projectId),
    prisma.completenessDismissal.findMany({ where: { projectId } }),
  ]);
  return summarizeReimport({
    activities, splitRules, dictionary, settledNames: status.settled,
    progressKeys: [...resolveCurrentProgress(entries).keys()].filter((k) => onSchedule.has(k)), previousSplitNames: splitNames,
    dismissed: new Set(dismissals.map((d) => `${d.canonicalActivityKey}::${d.coarseScope}`)),
  });
}

/**
 * After a re-import: split again every coarse scope this project split before
 * that the new schedule still flags (dismissals honoured, via getCompleteness).
 * One acceptSplit per scope, each chaining a synthetic import as a manual accept would.
 */
export async function reapplySplits(projectId: string, personId?: number | null): Promise<string[]> {
  const [splitRules, dictionary, names, { issues }] = await Promise.all([
    getCompletenessRules(), getDictionary(), previousSplitNames(projectId), getCompleteness(projectId),
  ]);
  const before = splitScopes(names, splitRules, dictionary);
  const scopes = [...new Set(issues.map((i) => i.coarseScope).filter((s) => before.has(s)))];
  for (const scope of scopes) await acceptSplit(projectId, scope, undefined, personId);
  return scopes;
}
