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
export function buildDictionary(
  rows: { normalizedName: string; canonicalScope: string }[],
  standard: string[] = [],
  settled: Set<string> = new Set(),
): Map<string, string> {
  const dict = new Map(rows.map((r) => [r.normalizedName, r.canonicalScope]));
  for (const scope of [...rows.map((r) => r.canonicalScope), ...standard]) {
    const self = normalizeName(scope);
    // An ignored or classified name stays unmapped even if it spells a standard name.
    if (!dict.has(self) && !settled.has(self)) dict.set(self, scope);
  }
  return dict;
}

export async function getDictionary(): Promise<Map<string, string>> {
  const [rows, standard, status] = await Promise.all([prisma.scopeDictionaryEntry.findMany(), getKnownScopes(), getNameStatus()]);
  return buildDictionary(rows, standard, status.settled);
}

export async function applyDictionary<A extends ActivityName>(activities: A[]): Promise<ApplyResult<A>> {
  return applyDictionaryWith(activities, await getDictionary());
}

export async function getKnownScopes(): Promise<string[]> {
  const rows = await prisma.standardScope.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => r.name);
}

/** The listed spelling of an approved name, matched exactly or else ignoring case; throws for anything off the list. */
export async function requireStandardScope(scope: string): Promise<string> {
  const name = scope.trim();
  const found = name && ((await prisma.standardScope.findUnique({ where: { name } }))
    ?? (await prisma.standardScope.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })));
  if (!found) throw new Error(`"${name}" is not on the standard name list.`);
  return found.name;
}

export async function addStandardScope(scope: string): Promise<string> {
  const name = scope.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("A standard name can't be blank.");
  const existing = await prisma.standardScope.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  return existing?.name ?? (await prisma.standardScope.create({ data: { name } })).name;
}

// createdBy on the dictionary entry a rename makes from the old spelling to the new name.
export const RENAME_ALIAS = "rename";

export type NameOutcome =
  | { mapTo: string }
  | { ignore: true }
  | { class: "coarse" | "procurement"; covers: string[] };

// One name, one outcome: mapping, ignoring or classifying a name clears the
// other two and any pending request for it. Callers check the scope is approved.
export async function settleName(normalizedName: string, outcome: NameOutcome, personId?: number | null): Promise<void> {
  await settleNames([{ normalizedName, outcome }], personId);
}

// settleName for many names (one item per name) in one transaction of
// set-based statements: a 6,000-row sheet was a 10-minute load at one
// transaction per name against Neon.
export async function settleNames(items: { normalizedName: string; outcome: NameOutcome }[], personId?: number | null): Promise<void> {
  const names = (keep: (o: NameOutcome) => boolean) => items.filter((i) => keep(i.outcome)).map((i) => i.normalizedName);
  const maps = items.flatMap((i) => ("mapTo" in i.outcome ? [{ normalizedName: i.normalizedName, canonicalScope: i.outcome.mapTo }] : []));
  const classes = items.flatMap((i) => ("class" in i.outcome ? [{ normalizedName: i.normalizedName, kind: i.outcome.class, covers: i.outcome.covers }] : []));
  const byScope = new Map<string, string[]>();
  for (const m of maps) byScope.set(m.canonicalScope, [...(byScope.get(m.canonicalScope) ?? []), m.normalizedName]);
  const all = { in: items.map((i) => i.normalizedName) };
  await prisma.$transaction([
    prisma.standardScopeRequest.deleteMany({ where: { normalizedName: all } }),
    prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: { in: names((o) => !("mapTo" in o)) } } }),
    prisma.scopeIgnoredName.deleteMany({ where: { normalizedName: { in: names((o) => !("ignore" in o)) } } }),
    // Classes are rewritten whole, so a reclassified name gets its new kind and covers.
    prisma.scopeNameClass.deleteMany({ where: { normalizedName: all } }),
    ...[...byScope].map(([canonicalScope, keys]) =>
      prisma.scopeDictionaryEntry.updateMany({ where: { normalizedName: { in: keys } }, data: { canonicalScope, timesConfirmed: { increment: 1 } } })),
    prisma.scopeDictionaryEntry.createMany({ data: maps, skipDuplicates: true }),
    prisma.scopeIgnoredName.createMany({ data: names((o) => "ignore" in o).map((normalizedName) => ({ normalizedName, personId: personId ?? null })), skipDuplicates: true }),
    prisma.scopeNameClass.createMany({ data: classes }),
  ]);
}

export async function requestStandardScope(
  rawName: string,
  by: { projectId: string; personId?: number | null; requestedBy?: string | null },
): Promise<void> {
  const normalizedName = normalizeName(rawName);
  if (!normalizedName) return;
  const data = { rawName: rawName.trim(), projectId: by.projectId, personId: by.personId ?? null, requestedBy: by.requestedBy ?? null };
  await prisma.standardScopeRequest.upsert({ where: { normalizedName }, create: { normalizedName, ...data }, update: {} });
}

/** Names already decided without a mapping (ignored or classified), and names awaiting an admin. */
export async function getNameStatus(): Promise<{ settled: Set<string>; requested: Set<string> }> {
  const [ignored, classes, requests] = await Promise.all([
    prisma.scopeIgnoredName.findMany({ select: { normalizedName: true } }),
    prisma.scopeNameClass.findMany({ select: { normalizedName: true } }),
    prisma.standardScopeRequest.findMany({ select: { normalizedName: true } }),
  ]);
  return {
    settled: new Set([...ignored, ...classes].map((r) => r.normalizedName)),
    requested: new Set(requests.map((r) => r.normalizedName)),
  };
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
  if (!normalizedName || !canonicalScope.trim()) return;
  await settleName(normalizedName, { mapTo: await requireStandardScope(canonicalScope) });
}
