// Pure duration benchmarks (roadmap Phase 5, Q66–Q71): per project and
// standard name, the span from first start to last finish of its mapped
// activities, then P25/median/P75 across projects by sector and building type.

import { isWeekend, workingDaysBetween } from "@/lib/forecast/workingDays";
import { isLeafActive } from "@/lib/msp/types";
import { normalizeName } from "@/lib/normalize/normalizeName";

export type Measure = "planned" | "actual";
export type GroupKind = "sector" | "buildingType";

export interface SpanActivity {
  name: string;
  type: string;
  isActive: boolean;
  isMilestone: boolean;
  plannedStart: Date | null;
  plannedFinish: Date | null;
  actualStart: Date | null;
  actualFinish: Date | null;
}

export interface Quartiles {
  p25: number;
  median: number;
  p75: number;
}

export interface BenchmarkStat extends Quartiles {
  canonicalScope: string;
  measure: Measure;
  groupKind: GroupKind;
  groupValue: string;
  n: number;
}

export interface Contribution {
  scope: string;
  measure: Measure;
  sector: string;
  buildingType: string | null;
  days: number;
}

export interface BenchmarkRange extends Quartiles {
  /** Sector projects behind the range. */
  n: number;
  /** Projects of this building type, and how much of the range they make up. */
  typeN: number;
  typeShare: number;
}

export type ScopeRanges = Record<Measure, BenchmarkRange | null>;

export interface ScopeBenchmarkView extends ScopeRanges {
  /** This project's own planned span for the name, from its latest import. */
  projectDays: number;
  /** projectDays is beyond the Tukey fences of the actual range (else the planned one). */
  outside: boolean;
}

// Prior strength k (Q54): a building type with k projects counts half. Tune against the full backfill.
export const PRIOR_STRENGTH = 5;
export const MIN_SECTOR_PROJECTS = 5;

/** Working days, inclusive, from each standard name's first start to its last finish. Actuals count only once every activity of the name has finished. */
export function scopeSpans(activities: SpanActivity[], dictionary: Map<string, string>, measure: Measure): Map<string, number> {
  const bounds = new Map<string, { start: number; finish: number } | null>();
  for (const a of activities) {
    if (!isLeafActive(a) || a.isMilestone) continue;
    const scope = dictionary.get(normalizeName(a.name));
    if (!scope || bounds.get(scope) === null) continue;
    const [start, finish] = measure === "planned" ? [a.plannedStart, a.plannedFinish] : [a.actualStart, a.actualFinish];
    if (!start || !finish) {
      // An unfinished activity makes its whole scope unfinished.
      if (measure === "actual") bounds.set(scope, null);
      continue;
    }
    const b = bounds.get(scope);
    bounds.set(scope, { start: Math.min(b?.start ?? Infinity, start.getTime()), finish: Math.max(b?.finish ?? -Infinity, finish.getTime()) });
  }
  const spans = new Map<string, number>();
  for (const [scope, b] of bounds) {
    if (!b || b.finish < b.start) continue;
    // Inclusive: the first day counts too, when it is a working day.
    const start = new Date(b.start);
    spans.set(scope, workingDaysBetween(start, new Date(b.finish)) + (isWeekend(start) ? 0 : 1));
  }
  return spans;
}

/** Linear-interpolated quartiles (the spreadsheet PERCENTILE method). */
export function quartiles(values: number[]): Quartiles {
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => {
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo);
  };
  return { p25: at(0.25), median: at(0.5), p75: at(0.75) };
}

/** One row per standard name, measure and group (each sector, each building type). Callers pass one contribution per project. */
export function aggregate(contributions: Contribution[]): BenchmarkStat[] {
  const groups = new Map<string, { key: Omit<BenchmarkStat, keyof Quartiles | "n">; days: number[] }>();
  const add = (c: Contribution, groupKind: GroupKind, groupValue: string) => {
    const id = JSON.stringify([c.scope, c.measure, groupKind, groupValue]);
    const g = groups.get(id) ?? { key: { canonicalScope: c.scope, measure: c.measure, groupKind, groupValue }, days: [] };
    g.days.push(c.days);
    groups.set(id, g);
  };
  for (const c of contributions) {
    add(c, "sector", c.sector);
    if (c.buildingType) add(c, "buildingType", c.buildingType);
  }
  return [...groups.values()].map(({ key, days }) => ({ ...key, n: days.length, ...quartiles(days) }));
}

/** The building type's quartiles shrunk toward the sector's: (n·type + k·sector) / (n + k). No range under MIN_SECTOR_PROJECTS sector projects. */
export function blend(
  sector: (Quartiles & { n: number }) | undefined,
  type: (Quartiles & { n: number }) | undefined,
  k = PRIOR_STRENGTH,
): BenchmarkRange | null {
  if (!sector || sector.n < MIN_SECTOR_PROJECTS) return null;
  const typeN = type?.n ?? 0;
  const w = typeN / (typeN + k);
  const mix = (f: keyof Quartiles) => (type ? w * type[f] + (1 - w) * sector[f] : sector[f]);
  return { p25: mix("p25"), median: mix("median"), p75: mix("p75"), n: sector.n, typeN, typeShare: w };
}

/** Beyond the Tukey fences: below P25 − 1.5·IQR or above P75 + 1.5·IQR (Q71). */
export function outsideRange(days: number, r: Quartiles): boolean {
  const iqr = r.p75 - r.p25;
  return days < r.p25 - 1.5 * iqr || days > r.p75 + 1.5 * iqr;
}
