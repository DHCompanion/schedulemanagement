import { prisma } from "@/lib/db";
import { importQuality } from "@/lib/health/healthService";
import { getDictionary } from "@/lib/normalize/normalizationService";
import { aggregate, blend, outsideRange, scopeSpans, type Contribution, type Measure, type Quartiles, type ScopeBenchmarkView, type ScopeRanges } from "@/lib/benchmarks/benchmarks";

// Rough and junk files feed no benchmarks (Q70).
const ELIGIBLE = new Set(["as_built", "baseline"]);

async function firstEligible(importIds: string[]) {
  for (const id of importIds) {
    const imp = await prisma.scheduleImport.findUniqueOrThrow({ where: { id }, include: { activities: true, relationships: true } });
    if (ELIGIBLE.has(importQuality(imp).tier)) return imp;
  }
  return null;
}

/**
 * Rebuild every benchmark from the imported schedules (Q68). One contribution
 * per project: planned spans from its earliest eligible import, actual spans
 * from its latest. Projects without a sector can't be grouped and are skipped.
 */
export async function recomputeBenchmarks(): Promise<{ projects: number; rows: number }> {
  const [dictionary, projects] = await Promise.all([
    getDictionary(),
    prisma.project.findMany({
      where: { sector: { not: null } },
      select: { sector: true, buildingType: true, imports: { where: { isSynthetic: false }, orderBy: { importedAt: "asc" }, select: { id: true } } },
    }),
  ]);
  const contributions: Contribution[] = [];
  let contributing = 0;
  for (const p of projects) {
    const ids = p.imports.map((i) => i.id);
    const earliest = await firstEligible(ids);
    if (!earliest) continue;
    const latest = (await firstEligible(ids.reverse())) ?? earliest;
    contributing++;
    for (const [measure, imp] of [["planned", earliest], ["actual", latest]] as const) {
      for (const [scope, days] of scopeSpans(imp.activities, dictionary, measure)) {
        contributions.push({ scope, measure, sector: p.sector!, buildingType: p.buildingType, days });
      }
    }
  }
  const rows = aggregate(contributions);
  const computedAt = new Date();
  await prisma.$transaction([
    prisma.scopeBenchmark.deleteMany(),
    prisma.scopeBenchmark.createMany({ data: rows.map((r) => ({ ...r, computedAt })) }),
  ]);
  return { projects: contributing, rows: rows.length };
}

export async function getBenchmarkStatus(): Promise<{ computedAt: Date | null; rows: number }> {
  const [latest, rows] = await Promise.all([
    prisma.scopeBenchmark.findFirst({ orderBy: { computedAt: "desc" }, select: { computedAt: true } }),
    prisma.scopeBenchmark.count(),
  ]);
  return { computedAt: latest?.computedAt ?? null, rows };
}

/** Per standard name, the planned and actual ranges for a project's sector, blended toward its building type. */
export async function getBenchmarkRanges(sector: string | null, buildingType: string | null): Promise<Map<string, ScopeRanges>> {
  if (!sector) return new Map();
  const rows = await prisma.scopeBenchmark.findMany({
    where: { OR: [{ groupKind: "sector", groupValue: sector }, ...(buildingType ? [{ groupKind: "buildingType", groupValue: buildingType }] : [])] },
  });
  const stat = new Map(rows.map((r) => [`${r.canonicalScope}|${r.measure}|${r.groupKind}`, r]));
  const ranges = new Map<string, ScopeRanges>();
  for (const scope of new Set(rows.map((r) => r.canonicalScope))) {
    const range = (m: Measure) => blend(stat.get(`${scope}|${m}|sector`), stat.get(`${scope}|${m}|buildingType`));
    const r = { actual: range("actual"), planned: range("planned") };
    if (r.actual || r.planned) ranges.set(scope, r);
  }
  return ranges;
}

/** Benchmarks for every standard name in a project's latest schedule that has a range. */
export async function getProjectBenchmarks(projectId: string): Promise<Map<string, ScopeBenchmarkView>> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { sector: true, buildingType: true } });
  const ranges = await getBenchmarkRanges(project?.sector ?? null, project?.buildingType ?? null);
  if (ranges.size === 0) return new Map();
  const latest = await prisma.scheduleImport.findFirst({ where: { projectId }, orderBy: { importedAt: "desc" }, include: { activities: true } });
  const spans = latest ? scopeSpans(latest.activities, await getDictionary(), "planned") : new Map<string, number>();
  const views = new Map<string, ScopeBenchmarkView>();
  for (const [scope, days] of spans) {
    const r = ranges.get(scope);
    if (!r) continue;
    const ref: Quartiles | null = r.actual ?? r.planned;
    views.set(scope, { ...r, projectDays: days, outside: !!ref && outsideRange(days, ref) });
  }
  return views;
}
