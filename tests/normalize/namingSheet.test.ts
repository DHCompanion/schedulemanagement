import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyNamingPlan, listChanges, planListChange, planNamingSheet } from "@/lib/normalize/namingSheet";

const review = (name: string, action: string, approved: string) => ({
  "Activity name": name, "Action (keep/merge/retire/map/ignore)": action, "Approved name": approved,
});
const batch = (current: string, standard: string) => ({ "Current name": current, "Standard name": standard });

describe("planNamingSheet", () => {
  it("reads the reviewed dictionary sheet as the whole standard list", () => {
    const plan = planNamingSheet(
      [review("demo", "merge", "Demolition"), review("demolition", "keep", "Demolition"), review("hvac — level 1", "retire", ""),
        review("<new task>", "ignore", ""), review("flooring", "map", "Install Flooring")],
      [], false,
    );
    expect(plan.standard).toEqual(["Demolition", "Install Flooring"]);
    expect(plan.ops).toEqual([
      { kind: "map", name: "demo", scope: "Demolition" },
      { kind: "map", name: "demolition", scope: "Demolition" },
      { kind: "unmap", name: "hvac — level 1" },
      { kind: "ignore", name: "<new task>" },
      { kind: "map", name: "flooring", scope: "Install Flooring" },
    ]);
    expect(plan.problems).toEqual([]);
  });

  it("reads a batch: keywords, approved names in any case, blanks skipped, unknown names reported", () => {
    const plan = planNamingSheet(
      [batch("Paint Walls", "paint"), batch("VAVs", "procurement"), batch("Buffer", "Ignore"), batch("Mob + ICRA", "coarse: Mobilization + ICRA Setup"),
        batch("Patch & Paint", "coarse"), batch("Leave me", " "), batch("Hydro test", "Hydrostatic Test")],
      ["Paint", "Mobilization", "ICRA Setup"], false,
    );
    expect(plan.standard).toBeNull();
    expect(plan.ops).toEqual([
      { kind: "map", name: "Paint Walls", scope: "Paint" },
      { kind: "class", name: "VAVs", class: "procurement", covers: [] },
      { kind: "ignore", name: "Buffer" },
      { kind: "class", name: "Mob + ICRA", class: "coarse", covers: ["Mobilization", "ICRA Setup"] },
      { kind: "class", name: "Patch & Paint", class: "coarse", covers: [] },
    ]);
    expect(plan.added).toEqual([]);
    expect(plan.problems).toEqual(['row 8: "Hydrostatic Test" is not a standard name']);
  });

  it("adds unknown names to the list when told to", () => {
    const plan = planNamingSheet([batch("Hydro test", "Hydrostatic Test"), batch("Hydro", "hydrostatic test")], [], true);
    expect(plan.added).toEqual(["Hydrostatic Test"]);
    expect(plan.ops.map((o) => o.kind === "map" && o.scope)).toEqual(["Hydrostatic Test", "Hydrostatic Test"]);
    expect(plan.problems).toEqual([]);
  });

  it("rejects a sheet with neither layout", () => {
    expect(() => planNamingSheet([{ a: "1" }], [], false)).toThrow(/columns/);
  });
});

describe("listChanges", () => {
  it("drops names off the sheet unless a split rule or trade entry still uses them", () => {
    expect(listChanges(["Demo", "Demolition", "hvac", "Flooring"], ["Demolition", "Paint"], ["Flooring"]))
      .toEqual({ add: ["Paint"], remove: ["Demo", "hvac"], kept: ["Flooring"] });
  });
});

describe.runIf(!!process.env.DATABASE_URL)("applyNamingPlan (db)", () => {
  const tag = `zn${Date.now()}`;
  afterAll(async () => {
    const where = { normalizedName: { contains: tag } };
    await prisma.scopeDictionaryEntry.deleteMany({ where });
    await prisma.scopeIgnoredName.deleteMany({ where });
    await prisma.scopeNameClass.deleteMany({ where });
    await prisma.standardScopeRequest.deleteMany({ where });
    await prisma.standardScope.deleteMany({ where: { name: { contains: tag } } });
    await prisma.$disconnect();
  });

  it("writes every op, settles requests, and changes nothing on a second run", async () => {
    await prisma.scopeIgnoredName.create({ data: { normalizedName: `walls ${tag}` } });
    await prisma.standardScopeRequest.create({ data: { normalizedName: `walls ${tag}`, rawName: `Walls ${tag}` } });
    const plan = {
      standard: null,
      added: [`Walls ${tag}`],
      problems: [],
      ops: [
        { kind: "map" as const, name: `Walls ${tag}`, scope: `Walls ${tag}` },
        { kind: "class" as const, name: `VAVs ${tag}`, class: "procurement" as const, covers: [] },
        { kind: "ignore" as const, name: `Buffer ${tag}` },
      ],
    };
    const first = await applyNamingPlan(plan);
    expect(first).toMatchObject({ mapped: 1, classified: 1, ignored: 1, added: 1 });
    expect(await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: `walls ${tag}` } })).toMatchObject({ canonicalScope: `Walls ${tag}` });
    expect(await prisma.scopeIgnoredName.findUnique({ where: { normalizedName: `walls ${tag}` } })).toBeNull();
    expect(await prisma.standardScopeRequest.findUnique({ where: { normalizedName: `walls ${tag}` } })).toBeNull();
    expect(await prisma.scopeNameClass.findUnique({ where: { normalizedName: `vavs ${tag}` } })).toMatchObject({ kind: "procurement" });

    expect(await applyNamingPlan(plan)).toMatchObject({ mapped: 0, classified: 0, ignored: 0, added: 0 });
  }, 30000);

  it("keeps a dropped name that an entry the sheet leaves alone still points at", async () => {
    await prisma.scopeDictionaryEntry.create({ data: { normalizedName: `untouched ${tag}`, canonicalScope: `Kept ${tag}` } });
    await prisma.scopeDictionaryEntry.create({ data: { normalizedName: `repointed ${tag}`, canonicalScope: `Gone ${tag}` } });
    const plan = { standard: [`New ${tag}`], added: [], problems: [], ops: [{ kind: "map" as const, name: `Repointed ${tag}`, scope: `New ${tag}` }] };
    expect(await planListChange(plan, [`Kept ${tag}`, `Gone ${tag}`]))
      .toEqual({ add: [`New ${tag}`], remove: [`Gone ${tag}`], kept: [`Kept ${tag}`] });
  }, 30000);

  it("lets the last row for a name win", async () => {
    const name = `Twice ${tag}`;
    await applyNamingPlan({
      standard: null, added: [`Walls ${tag}`], problems: [],
      ops: [{ kind: "map", name, scope: `Walls ${tag}` }, { kind: "ignore", name }, { kind: "map", name: ` ${name.toUpperCase()}`, scope: `Walls ${tag}` }],
    });
    expect(await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: `twice ${tag}` } })).toMatchObject({ canonicalScope: `Walls ${tag}` });
    expect(await prisma.scopeIgnoredName.findUnique({ where: { normalizedName: `twice ${tag}` } })).toBeNull();
  }, 30000);
});
