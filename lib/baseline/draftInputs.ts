import { prisma } from "@/lib/db";
import { SECTOR_OF } from "@/lib/historical";
import { MIN_SECTOR_PROJECTS, PRIOR_STRENGTH, blendShare } from "@/lib/benchmarks/benchmarks";
import { getBenchmarkRanges } from "@/lib/benchmarks/benchmarkService";
import { assembleDraft, type Draft, type DraftLink } from "@/lib/baseline/draftBaseline";
import type { RelationshipType } from "@/lib/msp/relationshipType";

export interface DraftGroup {
  buildingType: string;
  sector: string;
  sectorProjects: number;
  typeProjects: number;
}

export interface ChecklistItem {
  name: string;
  /** Blended share of past projects that had the name. */
  share: number;
}

const groupWhere = (g: { sector: string; buildingType: string }) => ({
  OR: [{ groupKind: "sector", groupValue: g.sector }, { groupKind: "buildingType", groupValue: g.buildingType }],
});

/** The benchmark groups behind a building type; an error when its sector has too few projects (decided 2026-10-26). */
export async function getDraftGroup(buildingType: string): Promise<DraftGroup | { error: string }> {
  const sector = SECTOR_OF.get(buildingType);
  if (!sector) return { error: `Unknown project type "${buildingType}".` };
  const rows = await prisma.benchmarkGroup.findMany({ where: groupWhere({ sector, buildingType }) });
  const count = (kind: string) => rows.find((r) => r.groupKind === kind)?.projects ?? 0;
  const g = { buildingType, sector, sectorProjects: count("sector"), typeProjects: count("buildingType") };
  if (g.sectorProjects < MIN_SECTOR_PROJECTS) {
    return { error: `Only ${g.sectorProjects} ${sector} projects have usable schedules; a draft needs ${MIN_SECTOR_PROJECTS}. Recompute benchmarks after more are imported.` };
  }
  return g;
}

/** Every name seen in the sector, by how often it appears (leaning on the building type where it has data). */
export async function getChecklist(g: DraftGroup): Promise<ChecklistItem[]> {
  const rows = await prisma.scopeCriticality.findMany({ where: groupWhere(g) });
  const by = new Map(rows.map((r) => [`${r.canonicalScope}|${r.groupKind}`, r.n]));
  const items: ChecklistItem[] = [];
  for (const name of new Set(rows.map((r) => r.canonicalScope))) {
    const typeN = by.get(`${name}|buildingType`);
    const b = blendShare(
      { n: g.sectorProjects, share: (by.get(`${name}|sector`) ?? 0) / g.sectorProjects },
      g.typeProjects ? { n: g.typeProjects, share: (typeN ?? 0) / g.typeProjects } : undefined,
    );
    if (b) items.push({ name, share: b.share });
  }
  return items.sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
}

export async function buildDraft(g: DraftGroup, names: string[], start: Date): Promise<Draft> {
  const [ranges, sequences] = await Promise.all([
    getBenchmarkRanges(g.sector, g.buildingType),
    prisma.scopeSequence.findMany({ where: { ...groupWhere(g), fromScope: { in: names }, toScope: { in: names } } }),
  ]);
  const scopes = names.map((name) => {
    // Days worked, not first-to-last span: phased work would otherwise count its idle months.
    const worked = ranges.get(name)?.worked ?? null;
    return { name, days: worked?.p75 ?? null, typeN: worked?.typeN ?? 0 };
  });
  // Pairs come from the sector; the building type's own count pulls the share
  // where it has one. No 5-project floor here: thin links are kept and warned about.
  const typeRow = new Map(sequences.filter((s) => s.groupKind === "buildingType").map((s) => [`${s.fromScope}|${s.toScope}`, s]));
  const links: DraftLink[] = sequences
    .filter((s) => s.groupKind === "sector")
    .map((s) => {
      const t = typeRow.get(`${s.fromScope}|${s.toScope}`);
      const sectorShare = s.projects / s.base;
      const share = t ? (t.projects + PRIOR_STRENGTH * sectorShare) / (t.base + PRIOR_STRENGTH) : sectorShare;
      return { from: s.fromScope, to: s.toScope, share, base: s.base, type: s.type as RelationshipType, lagDays: s.lagDays };
    });
  return assembleDraft(scopes, links, start);
}

/** The draft form's query: ?type=…&start=YYYY-MM-DD&scope=…&scope=… (shared by the page and the download). */
export function readDraftQuery(q: URLSearchParams): { type: string; start: Date | null; scopes: string[] } {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(q.get("start") ?? "") ? new Date(`${q.get("start")}T00:00:00Z`) : null;
  const scopes = [...new Set(q.getAll("scope").map((s) => s.trim()).filter(Boolean))];
  return { type: (q.get("type") ?? "").trim(), start: start && !isNaN(start.getTime()) ? start : null, scopes };
}
