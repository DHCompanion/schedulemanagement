// Pure, deterministic granularity check: flags activities whose normalized
// scope (from the 5a dictionary) has been marked "coarse" via a split rule.
// No DB, no AI. Computed entirely at read time.

export interface CompletenessActivity {
  canonicalActivityKey: string;
  externalId: number | null;
  wbsCode: string | null;
  name: string;
  canonicalScope: string | null;
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
  const issues: CompletenessIssue[] = [];
  for (const a of activities) {
    if (!a.canonicalScope) continue;
    const finerScopes = splitRules.get(a.canonicalScope);
    if (!finerScopes || finerScopes.length === 0) continue;
    issues.push({
      canonicalActivityKey: a.canonicalActivityKey,
      externalId: a.externalId,
      wbsCode: a.wbsCode,
      name: a.name,
      coarseScope: a.canonicalScope,
      finerScopes,
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
