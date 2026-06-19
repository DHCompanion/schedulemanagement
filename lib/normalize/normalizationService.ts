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

export async function getDictionary(): Promise<Map<string, string>> {
  const rows = await prisma.scopeDictionaryEntry.findMany();
  return new Map(rows.map((r) => [r.normalizedName, r.canonicalScope]));
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
