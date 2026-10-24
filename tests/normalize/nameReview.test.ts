import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";
import { signSession } from "@/lib/scope";
import { buildNameReview, getNameReview, type NameCount } from "@/lib/normalize/nameReview";

const row = (normalizedName: string, projects: number, over: Partial<NameCount> = {}): NameCount => ({
  normalizedName, sampleName: normalizedName, projects, sampleProjects: ["A"], ...over,
});

describe("buildNameReview", () => {
  it("drops mapped and ignored names, keeps frequency order, and suggests the closest scope", () => {
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
    await projectWith("L1", "active", [`FRAME ${tag}`, `Once ${tag}`]);
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

  it("maps a name to a scope, or ignores it, for admins only", async () => {
    expect((await post({ name: `Frame ${tag}`, scope: "Framing" }, false)).status).toBe(403);
    expect((await post({ name: `Frame ${tag}`, scope: "Framing" })).status).toBe(303);
    expect(await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: `frame ${tag}` } })).toMatchObject({ canonicalScope: "Framing" });

    expect((await post({ name: `Buffer ${tag}`, ignore: "1" })).status).toBe(303);
    expect(await prisma.scopeIgnoredName.findUnique({ where: { normalizedName: `buffer ${tag}` } })).not.toBeNull();

    expect((await post({ name: `Other ${tag}`, scope: " " })).status).toBe(422);
  });
});
