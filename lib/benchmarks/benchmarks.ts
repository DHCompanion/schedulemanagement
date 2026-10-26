// Pure duration benchmarks (roadmap Phase 5, Q66–Q71): per project and
// standard name, the span from first start to last finish of its mapped
// activities, then P25/median/P75 across projects by sector and building type.

import { isWeekend, workingDaysBetween } from "@/lib/forecast/workingDays";
import { isLeafActive } from "@/lib/msp/types";
import { normalizeName } from "@/lib/normalize/normalizeName";

export type Measure = "planned" | "actual";
/** "worked": planned working days on which any of the name's activities is in progress (drafts, 2026-10-26). */
export type StoredMeasure = Measure | "worked";
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
  measure: StoredMeasure;
  groupKind: GroupKind;
  groupValue: string;
  n: number;
}

export interface Contribution {
  scope: string;
  measure: StoredMeasure;
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

export type ScopeRanges = Record<StoredMeasure, BenchmarkRange | null>;

export interface ScopeBenchmarkView extends ScopeRanges {
  /** This project's own planned span for the name, from its latest import. */
  projectDays: number;
  /** projectDays is beyond the Tukey fences of the actual range (else the planned one). */
  outside: boolean;
  /** Share of past projects that had the name on the critical path. */
  critical: { share: number; n: number; typeN: number } | null;
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

/**
 * Planned working days on which at least one of a name's activities is in
 * progress. Unlike the span, idle time between phases doesn't count: doors
 * hung in phase 1 and phase 3 months apart are a few weeks of work, not months.
 */
export function scopeWorkedDays(activities: SpanActivity[], dictionary: Map<string, string>): Map<string, number> {
  const days = new Map<string, Set<number>>();
  for (const a of activities) {
    if (!isLeafActive(a) || a.isMilestone || !a.plannedStart || !a.plannedFinish) continue;
    const scope = dictionary.get(normalizeName(a.name));
    if (!scope) continue;
    const set = days.get(scope) ?? new Set<number>();
    const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    for (let t = day(a.plannedStart); t <= day(a.plannedFinish); t += 86_400_000) {
      if (!isWeekend(new Date(t))) set.add(t);
    }
    days.set(scope, set);
  }
  return new Map([...days].filter(([, s]) => s.size > 0).map(([scope, s]) => [scope, s.size]));
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

// Sequencing pairs and criticality (Q69 PR B, spec Q17 #3–4), from the same
// eligible imports. Phase 7's baseline generator reads them.

export interface FactActivity extends SpanActivity {
  externalUid: number;
  isCritical: boolean;
}

export interface FactLink {
  predecessorExternalUid: number;
  successorExternalUid: number;
  type: string;
  lagMinutes: number | null;
  crossProject: boolean;
}

export interface ProjectFacts {
  sector: string;
  buildingType: string | null;
  scopes: Set<string>;
  /** Names with any activity on the file's critical path. */
  critical: Set<string>;
  /** JSON [from, to] → the link's commonest type and median lag in working days. */
  pairs: Map<string, { type: string; lagDays: number }>;
}

export interface CriticalityStat {
  canonicalScope: string;
  groupKind: GroupKind;
  groupValue: string;
  n: number;
  critical: number;
}

export interface SequenceStat {
  fromScope: string;
  toScope: string;
  groupKind: GroupKind;
  groupValue: string;
  /** Projects with the link, out of `base` projects that have both names. */
  projects: number;
  base: number;
  type: string;
  lagDays: number;
}

// A name counts as critical when any of its activities is, which inflates the
// share: at 0.5, 100 of 188 Healthcare names qualified; at 0.75, 29. Tune here.
export const USUALLY_CRITICAL = 0.75;

const mode = (xs: string[]) => {
  const counts = new Map<string, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
};

/**
 * One schedule's names, critical names and links between different names.
 * A link may run through activities with no standard name (milestones,
 * unmapped tasks): Frame Walls → Inspection → Install Sheetrock counts as
 * Frame Walls → Install Sheetrock, typed FS with no lag.
 */
export function scheduleFacts(
  activities: FactActivity[],
  links: FactLink[],
  dictionary: Map<string, string>,
  minutesPerDay: number,
): Pick<ProjectFacts, "scopes" | "critical" | "pairs"> {
  const scopeOf = new Map<number, string>();
  const critical = new Set<string>();
  for (const a of activities) {
    if (!isLeafActive(a) || a.isMilestone) continue;
    const scope = dictionary.get(normalizeName(a.name));
    if (!scope) continue;
    scopeOf.set(a.externalUid, scope);
    if (a.isCritical) critical.add(scope);
  }
  const next = new Map<number, FactLink[]>();
  for (const l of links) {
    if (!l.crossProject) next.set(l.predecessorExternalUid, [...(next.get(l.predecessorExternalUid) ?? []), l]);
  }
  const seen = new Map<string, { types: string[]; lags: number[] }>();
  const record = (from: string, to: string, type: string, lagDays: number) => {
    if (from === to) return;
    const key = JSON.stringify([from, to]);
    const s = seen.get(key) ?? { types: [], lags: [] };
    s.types.push(type);
    s.lags.push(lagDays);
    seen.set(key, s);
  };
  for (const [uid, from] of scopeOf) {
    // Walk forward until each path reaches an activity with a standard name.
    const visited = new Set([uid]);
    const stack = (next.get(uid) ?? []).map((l) => ({ l, direct: true }));
    while (stack.length) {
      const { l, direct } = stack.pop()!;
      const to = l.successorExternalUid;
      const scope = scopeOf.get(to);
      if (scope) record(from, scope, direct ? l.type : "FS", direct ? (l.lagMinutes ?? 0) / minutesPerDay : 0);
      else if (!visited.has(to)) {
        visited.add(to);
        for (const n of next.get(to) ?? []) stack.push({ l: n, direct: false });
      }
    }
  }
  const pairs = new Map([...seen].map(([k, s]) => [k, { type: mode(s.types), lagDays: quartiles(s.lags).median }]));
  return { scopes: new Set(scopeOf.values()), critical, pairs };
}

/**
 * Criticality per name and links between names, per sector and building type.
 * A sector keeps links seen in at least minPairProjects of its projects; each
 * building type keeps every link its sector keeps that it has both names for,
 * even at 0 or 1 links, so a type that rarely links a pair pulls its share down.
 */
export function aggregateFacts(facts: ProjectFacts[], minPairProjects = 2): {
  criticality: CriticalityStat[];
  sequences: SequenceStat[];
  groups: { groupKind: GroupKind; groupValue: string; projects: number }[];
} {
  const groups = new Map<string, { groupKind: GroupKind; groupValue: string; facts: ProjectFacts[] }>();
  for (const f of facts) {
    for (const [groupKind, groupValue] of [["sector", f.sector], ["buildingType", f.buildingType]] as const) {
      if (!groupValue) continue;
      const id = `${groupKind}|${groupValue}`;
      const g = groups.get(id) ?? { groupKind, groupValue, facts: [] };
      g.facts.push(f);
      groups.set(id, g);
    }
  }
  const criticality: CriticalityStat[] = [];
  const sequences: SequenceStat[] = [];
  type Links = Map<string, { types: string[]; lags: number[] }>;
  const linked: { groupKind: GroupKind; groupValue: string; fs: ProjectFacts[]; links: Links }[] = [];
  for (const { groupKind, groupValue, facts: fs } of groups.values()) {
    const crit = new Map<string, { n: number; critical: number }>();
    const links = new Map<string, { types: string[]; lags: number[] }>();
    for (const f of fs) {
      for (const scope of f.scopes) {
        const c = crit.get(scope) ?? { n: 0, critical: 0 };
        c.n++;
        if (f.critical.has(scope)) c.critical++;
        crit.set(scope, c);
      }
      for (const [key, p] of f.pairs) {
        const l = links.get(key) ?? { types: [], lags: [] };
        l.types.push(p.type);
        l.lags.push(p.lagDays);
        links.set(key, l);
      }
    }
    for (const [canonicalScope, c] of crit) criticality.push({ canonicalScope, groupKind, groupValue, ...c });
    linked.push({ groupKind, groupValue, fs, links });
  }
  const push = (g: (typeof linked)[number], key: string) => {
    const l = g.links.get(key) ?? { types: [], lags: [] };
    const [fromScope, toScope] = JSON.parse(key) as [string, string];
    const base = g.fs.filter((f) => f.scopes.has(fromScope) && f.scopes.has(toScope)).length;
    if (base === 0) return;
    // A building-type row with no links of its own only carries its count; type and lag come from the sector.
    const [type, lagDays] = l.types.length ? [mode(l.types), quartiles(l.lags).median] : ["FS", 0];
    sequences.push({ fromScope, toScope, groupKind: g.groupKind, groupValue: g.groupValue, projects: l.types.length, base, type, lagDays });
  };
  const sectorPairs = new Map<string, string[]>();
  for (const g of linked.filter((g) => g.groupKind === "sector")) {
    const keys = [...g.links].filter(([, l]) => l.types.length >= minPairProjects).map(([key]) => key);
    sectorPairs.set(g.groupValue, keys);
    for (const key of keys) push(g, key);
  }
  for (const g of linked.filter((g) => g.groupKind === "buildingType")) {
    for (const key of sectorPairs.get(g.fs[0].sector) ?? []) push(g, key);
  }
  const sizes = [...groups.values()].map(({ groupKind, groupValue, facts: fs }) => ({ groupKind, groupValue, projects: fs.length }));
  return { criticality, sequences, groups: sizes };
}

/** A share blended like blend(): (n·type + k·sector) / (n + k), nothing under MIN_SECTOR_PROJECTS. */
export function blendShare(
  sector: { n: number; share: number } | undefined,
  type: { n: number; share: number } | undefined,
  k = PRIOR_STRENGTH,
): { share: number; n: number; typeN: number } | null {
  if (!sector || sector.n < MIN_SECTOR_PROJECTS) return null;
  const typeN = type?.n ?? 0;
  const w = typeN / (typeN + k);
  return { share: type ? w * type.share + (1 - w) * sector.share : sector.share, n: sector.n, typeN };
}
