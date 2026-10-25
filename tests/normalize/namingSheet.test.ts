import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyNamingPlan, listChanges, planListChange, planNamingSheet } from "@/lib/normalize/namingSheet";

const review = (name: string, action: string, approved: string) => ({
  "Activity name": name, "Action (keep/merge/retire/map/ignore)": action, "Approved name": approved,
});
const batch = (current: string, standard: string) => ({ "Current name": current, "Standard name": standard });
const merge = (from: string, to: string) => ({ "From name": from, "To name": to });

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

  it("splits coarse covers on commas only when the text isn't itself a standard name, and allows 'coarse :'", () => {
    const plan = planNamingSheet(
      [batch("Form and Pour", "coarse : Form Foundations, Pour Foundations"), batch("TBP walls", "coarse: Tape, Bed, and Paint")],
      ["Form Foundations", "Pour Foundations", "Tape, Bed, and Paint"], false,
    );
    expect(plan.ops).toEqual([
      { kind: "class", name: "Form and Pour", class: "coarse", covers: ["Form Foundations", "Pour Foundations"] },
      { kind: "class", name: "TBP walls", class: "coarse", covers: ["Tape, Bed, and Paint"] },
    ]);
  });

  it("won't add a one-word lowercase value as a new name: it is a misspelled keyword", () => {
    const plan = planNamingSheet([batch("Foundation", "corase"), batch("Grading", "Grading")], [], true);
    expect(plan.added).toEqual(["Grading"]);
    expect(plan.problems).toEqual(['row 2: "corase" looks like a misspelled keyword']);
  });

  it("reads a merge sheet: rename or merge each From name into its To name, or delete it", () => {
    const plan = planNamingSheet([merge("Demo", "Demolition"), merge("ZZ Cross", "Delete"), merge("", "x"), merge("Roofing", " ")], [], false);
    expect(plan.ops).toEqual([
      { kind: "rename", name: "Demo", to: "Demolition" },
      { kind: "delete", name: "ZZ Cross" },
    ]);
    expect(plan.standard).toBeNull();
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

  it("runs a merge sheet in order, and skips rows already done on a second run", async () => {
    await prisma.standardScope.createMany({ data: [{ name: `Pull ${tag}` }, { name: `Old ${tag}` }] });
    const plan = {
      standard: null, added: [], problems: [],
      ops: [
        { kind: "rename" as const, name: `Pull ${tag}`, to: `Install ${tag}` },
        { kind: "rename" as const, name: `Install ${tag}`, to: `Install Cabling ${tag}` },
        { kind: "delete" as const, name: `Old ${tag}` },
      ],
    };
    expect(await applyNamingPlan(plan)).toMatchObject({ renamed: 2, deleted: 1 });
    expect((await prisma.standardScope.findMany({ where: { name: { contains: tag } } })).map((s) => s.name)).toContain(`Install Cabling ${tag}`);
    expect(await prisma.standardScope.count({ where: { name: { in: [`Pull ${tag}`, `Install ${tag}`, `Old ${tag}`] } } })).toBe(0);
    expect(await applyNamingPlan(plan)).toMatchObject({ renamed: 0, deleted: 0 });
  }, 30000);

  it("runs merge rows for the same name in different case one after another", async () => {
    await prisma.standardScope.createMany({ data: [{ name: `floor ${tag}` }, { name: `Floor ${tag}` }] });
    await applyNamingPlan({
      standard: null, added: [], problems: [],
      ops: [{ kind: "rename", name: `floor ${tag}`, to: `Floor ${tag}` }, { kind: "rename", name: `Floor ${tag}`, to: `Finish Floor ${tag}` }],
    });
    expect((await prisma.standardScope.findMany({ where: { name: { contains: `loor ${tag}` } } })).map((s) => s.name)).toEqual([`Finish Floor ${tag}`]);
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
