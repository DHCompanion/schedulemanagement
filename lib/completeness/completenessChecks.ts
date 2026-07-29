// Pure, deterministic granularity check: flags activities whose raw schedule
// name has been marked "coarse" via a split rule. No DB, no AI. Computed
// entirely at read time.
//
// Keyed on the raw name, not the normalized scope from the naming step, so this
// check stands on its own — granularity runs before naming in the setup wizard,
// when no activity has a canonical scope yet.

import { normalizeName } from "@/lib/normalize/normalizeName";

export interface CompletenessActivity {
  canonicalActivityKey: string;
  externalId: number | null;
  wbsCode: string | null;
  name: string;
}

export interface CompletenessIssue {
  canonicalActivityKey: string;
  externalId: number | null;
  wbsCode: string | null;
  name: string;
  coarseScope: string;
  finerScopes: string[];
}

export interface CompletenessSummary {
  total: number;
  byCoarseScope: { coarseScope: string; count: number }[];
}

export function checkCompleteness(activities: CompletenessActivity[], splitRules: Map<string, string[]>): CompletenessIssue[] {
  // Match case- and whitespace-insensitively, but report the rule's own spelling
  // — that string is the key everything downstream (dismissals, accepted splits)
  // is stored under.
  const byName = new Map<string, { coarseScope: string; finerScopes: string[] }>();
  for (const [coarseScope, finerScopes] of splitRules) {
    if (finerScopes.length > 0) byName.set(normalizeName(coarseScope), { coarseScope, finerScopes });
  }

  const issues: CompletenessIssue[] = [];
  for (const a of activities) {
    const rule = byName.get(normalizeName(a.name));
    if (!rule) continue;
    issues.push({
      canonicalActivityKey: a.canonicalActivityKey,
      externalId: a.externalId,
      wbsCode: a.wbsCode,
      name: a.name,
      coarseScope: rule.coarseScope,
      finerScopes: rule.finerScopes,
    });
  }
  issues.sort((x, y) => (x.wbsCode ?? "").localeCompare(y.wbsCode ?? "", undefined, { numeric: true }));
  return issues;
}

export function summarizeCompleteness(issues: CompletenessIssue[]): CompletenessSummary {
  const counts = new Map<string, number>();
  for (const i of issues) counts.set(i.coarseScope, (counts.get(i.coarseScope) ?? 0) + 1);
  return {
    total: issues.length,
    byCoarseScope: [...counts.entries()].map(([coarseScope, count]) => ({ coarseScope, count })),
  };
}
