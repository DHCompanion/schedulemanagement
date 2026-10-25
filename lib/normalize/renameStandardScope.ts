import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { requireStandardScope } from "@/lib/normalize/normalizationService";

// A standard name is stored as plain text wherever it is used, so renaming one
// rewrites every place in one transaction. Renaming onto a name already on the
// list merges the two. Unique keys that would collide keep the target's row.

export interface RenameResult {
  from: string;
  to: string;
  merged: boolean;
  conflicts: string[];
}

export async function renameStandardScope(fromName: string, toName: string): Promise<RenameResult> {
  const from = await requireStandardScope(fromName);
  const wanted = toName.trim().replace(/\s+/g, " ");
  if (!wanted) throw new Error("The new name can't be blank.");
  // Another listed name matching in any case is a merge; otherwise this is a rename (maybe just of case).
  const existing = await prisma.standardScope.findFirst({ where: { name: { equals: wanted, mode: "insensitive" }, NOT: { name: from } } });
  const to = existing?.name ?? wanted;
  const result: RenameResult = { from, to, merged: !!existing, conflicts: [] };
  if (to === from) return result;

  await prisma.$transaction(async (tx) => {
    await tx.standardScope.upsert({ where: { name: to }, create: { name: to }, update: {} });
    await tx.standardScope.delete({ where: { name: from } });
    await tx.scopeDictionaryEntry.updateMany({ where: { canonicalScope: from }, data: { canonicalScope: to } });

    // An activity spelled exactly like the old name used to map to it implicitly; keep that working.
    const self = normalizeName(from);
    const settled = (await tx.scopeIgnoredName.count({ where: { normalizedName: self } })) + (await tx.scopeNameClass.count({ where: { normalizedName: self } }));
    if (!settled && self !== normalizeName(to)) {
      await tx.scopeDictionaryEntry.createMany({ data: [{ normalizedName: self, canonicalScope: to }], skipDuplicates: true });
    }

    const [fromTrade, toTrade] = await Promise.all([
      tx.tradeDictionaryEntry.findUnique({ where: { canonicalScope: from } }),
      tx.tradeDictionaryEntry.findUnique({ where: { canonicalScope: to } }),
    ]);
    if (fromTrade && toTrade) {
      await tx.tradeDictionaryEntry.delete({ where: { id: fromTrade.id } });
      if (fromTrade.osDisciplineId !== toTrade.osDisciplineId) {
        result.conflicts.push(`trade: kept ${to} → ${toTrade.disciplineName}, dropped ${from} → ${fromTrade.disciplineName}`);
      }
    } else if (fromTrade) {
      await tx.tradeDictionaryEntry.update({ where: { id: fromTrade.id }, data: { canonicalScope: to } });
    }

    const rules = await tx.scopeSplitRule.findMany({ where: { OR: [{ coarseScope: from }, { finerScope: from }] } });
    for (const r of rules) {
      const coarseScope = r.coarseScope === from ? to : r.coarseScope;
      const finerScope = r.finerScope === from ? to : r.finerScope;
      const dupe = await tx.scopeSplitRule.findUnique({ where: { coarseScope_finerScope: { coarseScope, finerScope } } });
      if (coarseScope === finerScope || dupe) await tx.scopeSplitRule.delete({ where: { id: r.id } });
      else await tx.scopeSplitRule.update({ where: { id: r.id }, data: { coarseScope, finerScope } });
    }

    for (const d of await tx.completenessDismissal.findMany({ where: { coarseScope: from } })) {
      const key = { projectId: d.projectId, canonicalActivityKey: d.canonicalActivityKey, coarseScope: to };
      if (await tx.completenessDismissal.findUnique({ where: { projectId_canonicalActivityKey_coarseScope: key } })) {
        await tx.completenessDismissal.delete({ where: { id: d.id } });
      } else await tx.completenessDismissal.update({ where: { id: d.id }, data: { coarseScope: to } });
    }

    for (const d of await tx.tradeScopeDismissal.findMany({ where: { canonicalScope: from } })) {
      if (await tx.tradeScopeDismissal.findUnique({ where: { projectId_canonicalScope: { projectId: d.projectId, canonicalScope: to } } })) {
        await tx.tradeScopeDismissal.delete({ where: { id: d.id } });
      } else await tx.tradeScopeDismissal.update({ where: { id: d.id }, data: { canonicalScope: to } });
    }

    for (const c of await tx.scopeNameClass.findMany({ where: { covers: { has: from } } })) {
      const covers = [...new Set(c.covers.map((s) => (s === from ? to : s)))];
      await tx.scopeNameClass.update({ where: { normalizedName: c.normalizedName }, data: { covers } });
    }
  }, { timeout: 30000 });
  return result;
}

/**
 * Drop a name nothing should use: its trade entry, split rules and dismissals go
 * with it. A name still mapped or covered is refused — merge it instead.
 */
export async function deleteStandardScope(scope: string): Promise<void> {
  // Exact spelling only: "drywall" must never resolve to "Drywall" here.
  const name = scope.trim();
  if (!(await prisma.standardScope.findUnique({ where: { name } }))) throw new Error(`"${name}" is not on the standard name list.`);
  const inUse = (await prisma.scopeDictionaryEntry.count({ where: { canonicalScope: name } }))
    + (await prisma.scopeNameClass.count({ where: { covers: { has: name } } }));
  if (inUse) throw new Error(`"${name}" is still mapped from ${inUse} name(s); merge it into another name instead.`);
  await prisma.$transaction([
    prisma.tradeDictionaryEntry.deleteMany({ where: { canonicalScope: name } }),
    prisma.scopeSplitRule.deleteMany({ where: { OR: [{ coarseScope: name }, { finerScope: name }] } }),
    prisma.completenessDismissal.deleteMany({ where: { coarseScope: name } }),
    prisma.tradeScopeDismissal.deleteMany({ where: { canonicalScope: name } }),
    prisma.standardScope.delete({ where: { name } }),
  ]);
}
