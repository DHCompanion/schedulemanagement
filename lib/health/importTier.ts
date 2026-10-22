// Pure classification of an import into what it may feed: as-built and baseline
// files feed durations and sequencing, rough files only naming and breakdowns,
// junk feeds nothing. Read-time, like the other health checks.

import { MAX_BENCHMARK_NO_PREDECESSOR, MAX_BENCHMARK_NO_SUCCESSOR, MIN_ELIGIBLE_SCORE, type LogicScore } from "@/lib/health/logicChecks";

// ponytail: first-guess cut-offs; calibrated against real files in the Phase 3 pilot.
export const MIN_LEAVES = 10;
export const MIN_LINKS_PER_LEAF = 0.8;
export const MIN_ACTUALS_SHARE = 0.1;

export const IMPORT_TIERS = ["as_built", "baseline", "rough", "junk"] as const;
export type ImportTier = (typeof IMPORT_TIERS)[number];

export function isImportTier(value: string | null | undefined): value is ImportTier {
  return (IMPORT_TIERS as readonly string[]).includes(value ?? "");
}

export interface TierInput {
  leafCount: number;
  relationshipCount: number;
  leavesWithActuals: number;
  logic: LogicScore;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function classifyImport(input: TierInput): { tier: ImportTier; reasons: string[] } {
  const { leafCount, relationshipCount, leavesWithActuals, logic } = input;

  if (leafCount < MIN_LEAVES) {
    return { tier: "junk", reasons: [`Only ${leafCount} activities — too few to learn from.`] };
  }

  const rough: string[] = [];
  if (logic.noPredecessorPct > MAX_BENCHMARK_NO_PREDECESSOR)
    rough.push(`${pct(logic.noPredecessorPct)} of activities have no predecessor (limit ${pct(MAX_BENCHMARK_NO_PREDECESSOR)}) — likely pinned to typed-in dates.`);
  if (logic.noSuccessorPct > MAX_BENCHMARK_NO_SUCCESSOR)
    rough.push(`${pct(logic.noSuccessorPct)} of activities have no successor (limit ${pct(MAX_BENCHMARK_NO_SUCCESSOR)}).`);
  if (logic.score < MIN_ELIGIBLE_SCORE) rough.push(`Only ${logic.passed} of ${logic.total} logic checks pass.`);
  const linksPerLeaf = relationshipCount / leafCount;
  if (linksPerLeaf < MIN_LINKS_PER_LEAF) rough.push(`${linksPerLeaf.toFixed(2)} links per activity — too sparse to trust sequencing.`);
  if (rough.length) return { tier: "rough", reasons: rough };

  const actualsShare = leavesWithActuals / leafCount;
  // Status date is deliberately ignored: it's set too inconsistently in MS Project files to decide anything.
  if (actualsShare >= MIN_ACTUALS_SHARE) {
    return { tier: "as_built", reasons: [`${pct(actualsShare)} of activities have actual dates.`] };
  }
  return {
    tier: "baseline",
    reasons: [actualsShare === 0 ? "No actual dates — treated as a plan, not progress." : `Only ${pct(actualsShare)} of activities have actual dates.`],
  };
}
