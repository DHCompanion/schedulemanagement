// Pure classification of an import into what it may feed: as-built and baseline
// files feed durations and sequencing, rough files only naming and breakdowns,
// junk feeds nothing. Read-time, like the other health checks.

import type { LogicScore } from "@/lib/health/logicChecks";

// ponytail: first-guess cut-offs; calibrated against real files in the Phase 3 pilot.
export const MIN_LEAVES = 10;
export const MIN_LINKS_PER_LEAF = 0.8;
export const MIN_ACTUALS_SHARE = 0.1;

export type ImportTier = "as_built" | "baseline" | "rough" | "junk";

export interface TierInput {
  leafCount: number;
  relationshipCount: number;
  leavesWithActuals: number;
  hasStatusDate: boolean;
  logic: LogicScore;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function classifyImport(input: TierInput): { tier: ImportTier; reasons: string[] } {
  const { leafCount, relationshipCount, leavesWithActuals, hasStatusDate, logic } = input;

  if (leafCount < MIN_LEAVES) {
    return { tier: "junk", reasons: [`Only ${leafCount} activities — too few to learn from.`] };
  }

  const rough: string[] = [];
  const missing = logic.metrics.find((m) => m.key === "missing_logic");
  if (missing && !missing.pass) rough.push(`${pct(missing.pct)} of activities are missing a predecessor or successor.`);
  if (!logic.benchmarkEligible) rough.push(`${logic.passed} of ${logic.total} logic checks pass.`);
  const linksPerLeaf = relationshipCount / leafCount;
  if (linksPerLeaf < MIN_LINKS_PER_LEAF) rough.push(`${linksPerLeaf.toFixed(2)} links per activity — too sparse to trust sequencing.`);
  if (rough.length) return { tier: "rough", reasons: rough };

  const actualsShare = leavesWithActuals / leafCount;
  if (hasStatusDate && actualsShare >= MIN_ACTUALS_SHARE) {
    return { tier: "as_built", reasons: [`${pct(actualsShare)} of activities have actual dates.`] };
  }
  return {
    tier: "baseline",
    reasons: [hasStatusDate ? `Only ${pct(actualsShare)} of activities have actual dates.` : "No status date — treated as a plan, not progress."],
  };
}
