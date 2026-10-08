import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/normalize/normalizeName";

export async function getSplitRules(): Promise<Map<string, string[]>> {
  const rows = await prisma.scopeSplitRule.findMany({ orderBy: [{ coarseScope: "asc" }, { finerScope: "asc" }] });
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.coarseScope) ?? [];
    list.push(r.finerScope);
    map.set(r.coarseScope, list);
  }
  return map;
}

export async function addSplitRule(coarseScope: string, finerScope: string, createdBy?: string): Promise<void> {
  const coarse = coarseScope.trim();
  const finer = finerScope.trim();
  if (!coarse || !finer) return;
  await prisma.scopeSplitRule.upsert({
    where: { coarseScope_finerScope: { coarseScope: coarse, finerScope: finer } },
    create: { coarseScope: coarse, finerScope: finer, createdBy },
    update: {},
  });
}

export async function removeSplitRule(coarseScope: string, finerScope: string): Promise<void> {
  await prisma.scopeSplitRule.deleteMany({
    where: { coarseScope: coarseScope.trim(), finerScope: finerScope.trim() },
  });
}

/** Normalized names an admin has reviewed and marked as not coarse. */
export async function getNotCoarseNames(): Promise<Set<string>> {
  const rows = await prisma.scopeNotCoarse.findMany({ select: { normalizedName: true } });
  return new Set(rows.map((r) => r.normalizedName));
}

export async function markNotCoarse(name: string, personId?: number | null): Promise<void> {
  const normalizedName = normalizeName(name);
  if (!normalizedName) return;
  await prisma.scopeNotCoarse.upsert({
    where: { normalizedName },
    create: { normalizedName, personId: personId ?? null },
    update: {},
  });
}

export async function unmarkNotCoarse(name: string): Promise<void> {
  await prisma.scopeNotCoarse.deleteMany({ where: { normalizedName: normalizeName(name) } });
}
