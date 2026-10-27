import { prisma } from "@/lib/db";
import { SECTOR_OF, parseSubType } from "@/lib/historical";
import { MIN_SECTOR_PROJECTS, PRIOR_STRENGTH, SUBTYPE_PRIOR, blendShare } from "@/lib/benchmarks/benchmarks";
import { getBenchmarkRanges, groupFilter } from "@/lib/benchmarks/benchmarkService";
import { assembleDraft, type Draft, type DraftLink } from "@/lib/baseline/draftBaseline";
import type { RelationshipType } from "@/lib/msp/relationshipType";

export interface DraftGroup {
  buildingType: string;
  subType: string | null;
  sector: string;
  sectorProjects: number;
  typeProjects: number;
  subTypeProjects: number;
}

export interface ChecklistItem {
  name: string;
  /** Blended share of past projects that had the name. */
  share: number;
}

const groupWhere = (g: { sector: string; buildingType: string; subType: string | null }) => groupFilter(g.sector, g.buildingType, g.subType);

/** The benchmark groups behind a building type and optional subtype; an error when its sector has too few projects (decided 2026-10-26). */
export async function getDraftGroup(buildingType: string, rawSubType = ""): Promise<DraftGroup | { error: string }> {
  const sector = SECTOR_OF.get(buildingType);
  if (!sector) return { error: `Unknown project type "${buildingType}".` };
  let subType: string | null;
  try {
    subType = parseSubType(buildingType, rawSubType);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const rows = await prisma.benchmarkGroup.findMany({ where: groupWhere({ sector, buildingType, subType }) });
  const count = (kind: string) => rows.find((r) => r.groupKind === kind)?.projects ?? 0;
  const g = { buildingType, subType, sector, sectorProjects: count("sector"), typeProjects: count("buildingType"), subTypeProjects: count("subType") };
  if (g.sectorProjects < MIN_SECTOR_PROJECTS) {
    return { error: `Only ${g.sectorProjects} ${sector} projects have usable schedules; a draft needs ${MIN_SECTOR_PROJECTS}. Recompute benchmarks after more are imported.` };
  }
  return g;
}

/** Every name seen in the sector, by how often it appears (leaning on the building type and subtype where they have data). */
export async function getChecklist(g: DraftGroup): Promise<ChecklistItem[]> {
  const rows = await prisma.scopeCriticality.findMany({ where: groupWhere(g) });
  const by = new Map(rows.map((r) => [`${r.canonicalScope}|${r.groupKind}`, r.n]));
  const items: ChecklistItem[] = [];
  for (const name of new Set(rows.map((r) => r.canonicalScope))) {
    const part = (kind: string, n: number) => (n ? { n, share: (by.get(`${name}|${kind}`) ?? 0) / n } : undefined);
    const b = blendShare(part("sector", g.sectorProjects), part("buildingType", g.typeProjects), part("subType", g.subTypeProjects));
    if (b) items.push({ name, share: b.share });
  }
  return items.sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
}

export async function buildDraft(g: DraftGroup, names: string[], start: Date): Promise<Draft> {
  const [ranges, sequences] = await Promise.all([
    // Any project counts here: a ticked specialty name with a few schedules beats none (flagged thin).
    getBenchmarkRanges(g.sector, g.buildingType, g.subType, 1),
    prisma.scopeSequence.findMany({ where: { ...groupWhere(g), fromScope: { in: names }, toScope: { in: names } } }),
  ]);
  const scopes = names.map((name) => {
    // Days worked, not first-to-last span: phased work would otherwise count its idle months.
    const worked = ranges.get(name)?.worked ?? null;
    return { name, days: worked?.p75 ?? null, typeN: worked?.typeN ?? 0, n: worked?.n ?? 0 };
  });
  // Pairs come from the sector; the building type's and subtype's own counts pull
  // the share where they have one. No 5-project floor here: thin links are kept and warned about.
  const row = (kind: string) => new Map(sequences.filter((s) => s.groupKind === kind).map((s) => [`${s.fromScope}|${s.toScope}`, s]));
  const [typeRow, subRow] = [row("buildingType"), row("subType")];
  const pull = (prior: number, r: { projects: number; base: number } | undefined, k: number) => (r ? (r.projects + k * prior) / (r.base + k) : prior);
  const links: DraftLink[] = sequences
    .filter((s) => s.groupKind === "sector")
    .map((s) => {
      const key = `${s.fromScope}|${s.toScope}`;
      const share = pull(pull(s.projects / s.base, typeRow.get(key), PRIOR_STRENGTH), subRow.get(key), SUBTYPE_PRIOR);
      return { from: s.fromScope, to: s.toScope, share, base: s.base, type: s.type as RelationshipType, lagDays: s.lagDays };
    });
  return assembleDraft(scopes, links, start);
}

/** The draft form's query: ?type=…&sub=…&start=YYYY-MM-DD&scope=…&scope=… (shared by the page and the download). */
export function readDraftQuery(q: URLSearchParams): { type: string; subType: string; start: Date | null; scopes: string[] } {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(q.get("start") ?? "") ? new Date(`${q.get("start")}T00:00:00Z`) : null;
  const scopes = [...new Set(q.getAll("scope").map((s) => s.trim()).filter(Boolean))];
  return { type: (q.get("type") ?? "").trim(), subType: (q.get("sub") ?? "").trim(), start: start && !isNaN(start.getTime()) ? start : null, scopes };
}
