import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { deleteStandardScope, getRenameAliases, renameStandardScope } from "@/lib/normalize/renameStandardScope";
import { RENAME_ALIAS, confirmMapping } from "@/lib/normalize/normalizationService";

describe.runIf(!!process.env.DATABASE_URL)("renameStandardScope (db)", () => {
  const tag = `zr${Date.now()}`;
  const t = (s: string) => `${s} ${tag}`;
  const projectIds: string[] = [];
  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    const name = { contains: tag };
    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: name } });
    await prisma.scopeNameClass.deleteMany({ where: { normalizedName: name } });
    await prisma.scopeIgnoredName.deleteMany({ where: { normalizedName: name } });
    await prisma.tradeDictionaryEntry.deleteMany({ where: { canonicalScope: name } });
    await prisma.scopeSplitRule.deleteMany({ where: { OR: [{ coarseScope: name }, { finerScope: name }] } });
    await prisma.standardScope.deleteMany({ where: { name } });
    await prisma.$disconnect();
  });

  async function project() {
    const p = await prisma.project.create({ data: { name: t("P"), status: "active" } });
    projectIds.push(p.id);
    return p.id;
  }

  it("renames a name everywhere it is stored, and maps the old spelling to the new one", async () => {
    const [from, to] = [t("Pull LV Cabling"), t("Install LV Cabling")];
    const pid = await project();
    await prisma.standardScope.create({ data: { name: from } });
    await prisma.scopeDictionaryEntry.create({ data: { normalizedName: t("lv pull").toLowerCase(), canonicalScope: from } });
    await prisma.tradeDictionaryEntry.create({ data: { canonicalScope: from, osDisciplineId: 7, disciplineName: "LV" } });
    await prisma.scopeSplitRule.create({ data: { coarseScope: from, finerScope: t("Trimout LV") } });
    await prisma.completenessDismissal.create({ data: { projectId: pid, canonicalActivityKey: "k1", coarseScope: from } });
    await prisma.tradeScopeDismissal.create({ data: { projectId: pid, canonicalScope: from } });
    await prisma.scopeNameClass.create({ data: { normalizedName: t("lv and trim").toLowerCase(), kind: "coarse", covers: [from, t("Trimout LV")] } });

    expect(await renameStandardScope(from.toUpperCase(), `  ${to} `)).toMatchObject({ from, to, merged: false, conflicts: [] });

    expect(await prisma.standardScope.findUnique({ where: { name: from } })).toBeNull();
    expect(await prisma.standardScope.findUnique({ where: { name: to } })).not.toBeNull();
    expect(await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: t("lv pull").toLowerCase() } })).toMatchObject({ canonicalScope: to });
    expect(await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: from.toLowerCase() } })).toMatchObject({ canonicalScope: to, createdBy: RENAME_ALIAS });
    expect((await getRenameAliases()).get(from.toLowerCase())).toBe(to);
    // Mapping the old spelling elsewhere later ends the alias.
    await prisma.standardScope.create({ data: { name: t("Other") } });
    await confirmMapping(from, t("Other"));
    expect((await getRenameAliases()).has(from.toLowerCase())).toBe(false);
    expect(await prisma.tradeDictionaryEntry.findUnique({ where: { canonicalScope: to } })).toMatchObject({ osDisciplineId: 7 });
    expect(await prisma.scopeSplitRule.findFirst({ where: { coarseScope: to } })).toMatchObject({ finerScope: t("Trimout LV") });
    expect(await prisma.completenessDismissal.findFirst({ where: { projectId: pid } })).toMatchObject({ coarseScope: to });
    expect(await prisma.tradeScopeDismissal.findFirst({ where: { projectId: pid } })).toMatchObject({ canonicalScope: to });
    expect((await prisma.scopeNameClass.findUnique({ where: { normalizedName: t("lv and trim").toLowerCase() } }))?.covers).toEqual([to, t("Trimout LV")]);
  }, 30000);

  it("merges into a listed name: duplicates collapse, the target's trade wins and is reported", async () => {
    const [from, to, finer] = [t("Demo"), t("Demolition"), t("Demolish Walls")];
    const pid = await project();
    await prisma.standardScope.createMany({ data: [{ name: from }, { name: to }] });
    await prisma.tradeDictionaryEntry.createMany({
      data: [{ canonicalScope: from, osDisciplineId: 1, disciplineName: "Demo" }, { canonicalScope: to, osDisciplineId: 2, disciplineName: "Demolition" }],
    });
    await prisma.scopeSplitRule.createMany({
      data: [{ coarseScope: from, finerScope: finer }, { coarseScope: to, finerScope: finer }, { coarseScope: to, finerScope: from }],
    });
    await prisma.tradeScopeDismissal.createMany({ data: [{ projectId: pid, canonicalScope: from }, { projectId: pid, canonicalScope: to }] });
    await prisma.scopeNameClass.create({ data: { normalizedName: t("demo and demolition").toLowerCase(), kind: "coarse", covers: [from, to] } });

    const result = await renameStandardScope(from, to.toLowerCase());
    expect(result).toMatchObject({ from, to, merged: true });
    expect(result.conflicts).toEqual([`trade: kept ${to} → Demolition, dropped ${from} → Demo`]);

    expect(await prisma.standardScope.count({ where: { name: { in: [from, to] } } })).toBe(1);
    expect((await prisma.tradeDictionaryEntry.findMany({ where: { canonicalScope: { in: [from, to] } } })).map((r) => r.osDisciplineId)).toEqual([2]);
    // to→finer twice collapses to one; to→from becomes to→to and is dropped.
    expect(await prisma.scopeSplitRule.findMany({ where: { coarseScope: { in: [from, to] } }, select: { coarseScope: true, finerScope: true } }))
      .toEqual([{ coarseScope: to, finerScope: finer }]);
    expect(await prisma.tradeScopeDismissal.count({ where: { projectId: pid } })).toBe(1);
    expect((await prisma.scopeNameClass.findUnique({ where: { normalizedName: t("demo and demolition").toLowerCase() } }))?.covers).toEqual([to]);
  }, 30000);

  it("merges a lowercase legacy name into the same name in title case", async () => {
    const [from, to] = [t("flooring"), t("Flooring")];
    await prisma.standardScope.createMany({ data: [{ name: from }, { name: to }] });
    await prisma.tradeDictionaryEntry.create({ data: { canonicalScope: from, osDisciplineId: 4, disciplineName: "Flooring" } });
    expect(await renameStandardScope(from, to)).toMatchObject({ from, to, merged: true });
    expect(await prisma.standardScope.findUnique({ where: { name: from } })).toBeNull();
    expect(await prisma.tradeDictionaryEntry.findUnique({ where: { canonicalScope: to } })).not.toBeNull();
  }, 30000);

  it("leaves an old spelling that was ignored or classified alone", async () => {
    const [from, to] = [t("Close Up"), t("Close Walls")];
    await prisma.standardScope.create({ data: { name: from } });
    await prisma.scopeIgnoredName.create({ data: { normalizedName: from.toLowerCase() } });
    await renameStandardScope(from, to);
    expect(await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: from.toLowerCase() } })).toBeNull();
  }, 30000);

  it("refuses an unlisted source and a blank target", async () => {
    await expect(renameStandardScope(t("Nope"), t("X"))).rejects.toThrow(/not on the standard name list/);
    await prisma.standardScope.create({ data: { name: t("Lonely") } });
    await expect(renameStandardScope(t("Lonely"), "  ")).rejects.toThrow(/blank/);
  }, 30000);

  it("deletes an unmapped name with its trade entry and split rules, but refuses one still in use", async () => {
    const [gone, used] = [t("ZZ Cross"), t("Part A")];
    await prisma.standardScope.createMany({ data: [{ name: gone }, { name: used }] });
    await prisma.scopeSplitRule.create({ data: { coarseScope: gone, finerScope: used } });
    await prisma.tradeDictionaryEntry.create({ data: { canonicalScope: gone, osDisciplineId: 3, disciplineName: "Test" } });
    await prisma.scopeDictionaryEntry.create({ data: { normalizedName: t("part a raw").toLowerCase(), canonicalScope: used } });

    await expect(deleteStandardScope(used)).rejects.toThrow(/still mapped/);
    await deleteStandardScope(gone);
    expect(await prisma.standardScope.findUnique({ where: { name: gone } })).toBeNull();
    expect(await prisma.scopeSplitRule.count({ where: { coarseScope: gone } })).toBe(0);
    expect(await prisma.tradeDictionaryEntry.count({ where: { canonicalScope: gone } })).toBe(0);
    expect(await prisma.standardScope.findUnique({ where: { name: used } })).not.toBeNull();
  }, 30000);
});
