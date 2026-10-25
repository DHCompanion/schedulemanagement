import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";
import { signSession } from "@/lib/scope";
import { buildNameReview, getNameRequests, getNameReview, type NameCount } from "@/lib/normalize/nameReview";

const row = (normalizedName: string, projects: number, over: Partial<NameCount> = {}): NameCount => ({
  normalizedName, sampleName: normalizedName, projects, sampleProjects: ["A"], ...over,
});

describe("buildNameReview", () => {
  it("drops mapped and settled names, keeps frequency order, and suggests the closest scope", () => {
    const dict = new Map([["hang drywall", "Drywall"]]);
    const out = buildNameReview(
      [row("hang drywall", 9), row("notice to proceed", 8), row("tape drywall level 2", 5)],
      dict,
      new Set(["notice to proceed"]),
      ["Drywall", "Paint"],
    );
    expect(out).toEqual([{ ...row("tape drywall level 2", 5), suggestion: "Drywall" }]);
  });

  it("leaves the suggestion blank when nothing overlaps", () => {
    expect(buildNameReview([row("mobilize", 4)], new Map(), new Set(), ["Drywall"])[0].suggestion).toBe("");
  });
});

describe.runIf(!!process.env.DATABASE_URL)("name review with a database", () => {
  const tag = `zq${Date.now()}`;
  const ids: string[] = [];
  const now = () => Math.floor(Date.now() / 1000);
  beforeEach(() => {
    process.env.SESSION_SIGNING_SECRET = "n".repeat(32);
  });
  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: ids } } });
    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: { contains: tag } } });
    await prisma.scopeIgnoredName.deleteMany({ where: { normalizedName: { contains: tag } } });
    await prisma.scopeNameClass.deleteMany({ where: { normalizedName: { contains: tag } } });
    await prisma.standardScopeRequest.deleteMany({ where: { normalizedName: { contains: tag } } });
    await prisma.standardScope.deleteMany({ where: { name: { contains: tag } } });
    await prisma.$disconnect();
  });

  async function projectWith(name: string, status: string, activityNames: string[]) {
    const p = await prisma.project.create({ data: { name, status } });
    ids.push(p.id);
    const imp = await prisma.scheduleImport.create({ data: { projectId: p.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "x" } });
    await prisma.activity.createMany({
      data: activityNames.map((n, i) => ({ scheduleImportId: imp.id, externalUid: i + 1, name: n, canonicalActivityKey: `${i}`, type: "task" })),
    });
  }

  it("counts distinct projects per name across historical and live projects, by normalized name", async () => {
    await projectWith("H1", "historical", [`Frame ${tag}`, `Frame ${tag}`]);
    await projectWith("H2", "historical", [`frame  ${tag}`]);
    await projectWith("L1", "active", [`\tFRAME ${tag}\n`, `Once ${tag}`]);
    const review = (await getNameReview(2)).filter((r) => r.normalizedName.includes(tag));
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({ normalizedName: `frame ${tag}`, projects: 3 });
    expect(review[0].sampleProjects.sort()).toEqual(["H1", "H2", "L1"]);
  });

  async function post(fields: Record<string, string>, admin = true) {
    const { POST } = await import("@/app/api/history/names/route");
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    const cookie = `${SESSION_COOKIE}=${await signSession(admin, now())}`;
    return POST(new Request("http://localhost/api/history/names", { method: "POST", body, headers: { Cookie: cookie } }));
  }

  it("maps a name to an approved scope, or ignores it, for admins only", async () => {
    await prisma.standardScope.create({ data: { name: `Framing ${tag}` } });
    expect((await post({ name: `Frame ${tag}`, scope: `Framing ${tag}` }, false)).status).toBe(403);
    expect((await post({ name: `Frame ${tag}`, scope: `Framing ${tag}` })).status).toBe(303);
    expect(await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: `frame ${tag}` } })).toMatchObject({ canonicalScope: `Framing ${tag}` });

    expect((await post({ name: `Buffer ${tag}`, ignore: "1" })).status).toBe(303);
    expect(await prisma.scopeIgnoredName.findUnique({ where: { normalizedName: `buffer ${tag}` } })).not.toBeNull();

    expect((await post({ name: `Other ${tag}`, scope: " " })).status).toBe(422);
    expect((await post({ name: `Other ${tag}`, scope: `Unlisted ${tag}` })).status).toBe(422);
  });

  it("classifies names as coarse or procurement", async () => {
    expect((await post({ name: `VAVs ${tag}`, class: "procurement" })).status).toBe(303);
    expect((await post({ name: `Mob and ICRA ${tag}`, class: "coarse" })).status).toBe(303);
    expect((await post({ name: `X ${tag}`, class: "other" })).status).toBe(422);
    const rows = await prisma.scopeNameClass.findMany({ where: { normalizedName: { contains: tag } }, orderBy: { kind: "asc" } });
    expect(rows.map((r) => r.kind)).toEqual(["coarse", "procurement"]);
  });

  it("approves a requested name: it joins the list, maps to itself, and leaves the queue", async () => {
    await prisma.standardScopeRequest.create({ data: { normalizedName: `hydro test ${tag}`, rawName: `Hydro Test ${tag}`, requestedBy: "Pat" } });
    expect((await getNameRequests()).some((r) => r.rawName === `Hydro Test ${tag}`)).toBe(true);
    expect((await post({ name: `Hydro Test ${tag}`, approve: "1" })).status).toBe(303);
    expect(await prisma.standardScope.findUnique({ where: { name: `Hydro Test ${tag}` } })).not.toBeNull();
    expect(await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: `hydro test ${tag}` } })).toMatchObject({ canonicalScope: `Hydro Test ${tag}` });
    expect((await getNameRequests()).some((r) => r.rawName === `Hydro Test ${tag}`)).toBe(false);
  });

  it("adds a standard name without mapping anything", async () => {
    expect((await post({ newScope: `  Site  Fencing ${tag} ` })).status).toBe(303);
    expect(await prisma.standardScope.findUnique({ where: { name: `Site Fencing ${tag}` } })).not.toBeNull();
  });
});
