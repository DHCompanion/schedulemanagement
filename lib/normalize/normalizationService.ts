import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/normalize/normalizeName";

export interface ActivityName {
  name: string;
}

export interface ApplyResult<A> {
  mapped: { activity: A; canonicalScope: string }[];
  unmappedNames: string[];
}

export function applyDictionaryWith<A extends ActivityName>(activities: A[], dict: Map<string, string>): ApplyResult<A> {
  const mapped: { activity: A; canonicalScope: string }[] = [];
  const unmapped = new Set<string>();
  for (const a of activities) {
    const scope = dict.get(normalizeName(a.name));
    if (scope) mapped.push({ activity: a, canonicalScope: scope });
    else unmapped.add(a.name.trim());
  }
  return { mapped, unmappedNames: [...unmapped] };
}

/**
 * A standard scope is itself a standard name: an activity literally called
 * "Plumbing Overhead Rough-In" needs no entry to map to that scope. Without
 * this, such a name — typically one minted by an accepted split — showed up for
 * review with itself as the suggestion. An explicit entry still wins.
 */
export function buildDictionary(rows: { normalizedName: string; canonicalScope: string }[]): Map<string, string> {
  const dict = new Map(rows.map((r) => [r.normalizedName, r.canonicalScope]));
  for (const r of rows) {
    const self = normalizeName(r.canonicalScope);
    if (!dict.has(self)) dict.set(self, r.canonicalScope);
  }
  return dict;
}

export async function getDictionary(): Promise<Map<string, string>> {
  return buildDictionary(await prisma.scopeDictionaryEntry.findMany());
}

export async function applyDictionary<A extends ActivityName>(activities: A[]): Promise<ApplyResult<A>> {
  return applyDictionaryWith(activities, await getDictionary());
}

export async function getKnownScopes(): Promise<string[]> {
  const rows = await prisma.scopeDictionaryEntry.findMany({
    distinct: ["canonicalScope"],
    select: { canonicalScope: true },
    orderBy: { canonicalScope: "asc" },
  });
  return rows.map((r) => r.canonicalScope);
}

// The dictionary is global and keyed on the raw name, so one bad entry follows
// every project and every future import. Undoing it has to be possible.
export async function removeMapping(rawName: string): Promise<void> {
  const normalizedName = normalizeName(rawName);
  if (!normalizedName) return;
  await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName } });
}

export async function confirmMapping(rawName: string, canonicalScope: string): Promise<void> {
  const normalizedName = normalizeName(rawName);
  const scope = canonicalScope.trim();
  if (!normalizedName || !scope) return;
  await prisma.scopeDictionaryEntry.upsert({
    where: { normalizedName },
    create: { normalizedName, canonicalScope: scope },
    update: { canonicalScope: scope, timesConfirmed: { increment: 1 } },
  });
}
