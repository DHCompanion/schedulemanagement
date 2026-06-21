import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getCompleteness, dismissIssue } from "@/lib/completeness/completenessService";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("completenessService", () => {
  let projectId = "";
  let projectId2 = "";
  const coarse = `ZZ Coarse ${Date.now()}`;

  afterAll(async () => {
    await prisma.scopeSplitRule.deleteMany({ where: { coarseScope: coarse } });
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    if (projectId2) await prisma.project.delete({ where: { id: projectId2 } });
    await prisma.$disconnect();
  });

  async function makeProjectWithActivity(name: string, activityName: string) {
    const project = await prisma.project.create({ data: { name } });
    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: `h-${project.id}` },
    });
    await prisma.activity.create({
      data: {
        scheduleImportId: imp.id,
        externalUid: 1,
        externalId: 1,
        wbsCode: "1",
        name: activityName,
        canonicalActivityKey: `1|${activityName.toLowerCase()}`,
        type: "task",
      },
    });
    return project.id;
  }

  it("flags an activity mapped to a coarse scope, then hides it once dismissed", async () => {
    await prisma.scopeSplitRule.create({ data: { coarseScope: coarse, finerScope: "Finer A" } });
    await prisma.scopeDictionaryEntry.upsert({
      where: { normalizedName: coarse.toLowerCase() },
      create: { normalizedName: coarse.toLowerCase(), canonicalScope: coarse },
      update: { canonicalScope: coarse },
    });

    projectId = await makeProjectWithActivity("Completeness Test", coarse);

    const before = await getCompleteness(projectId);
    expect(before.hasImport).toBe(true);
    expect(before.issues).toHaveLength(1);
    expect(before.issues[0].coarseScope).toBe(coarse);

    await dismissIssue(projectId, before.issues[0].canonicalActivityKey, coarse);
    const after = await getCompleteness(projectId);
    expect(after.issues).toHaveLength(0);

    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: coarse.toLowerCase() } });
  }, 30000);

  it("scopes dismissal per project", async () => {
    await prisma.scopeSplitRule.upsert({
      where: { coarseScope_finerScope: { coarseScope: coarse, finerScope: "Finer A" } },
      create: { coarseScope: coarse, finerScope: "Finer A" },
      update: {},
    });
    await prisma.scopeDictionaryEntry.upsert({
      where: { normalizedName: coarse.toLowerCase() },
      create: { normalizedName: coarse.toLowerCase(), canonicalScope: coarse },
      update: { canonicalScope: coarse },
    });

    projectId2 = await makeProjectWithActivity("Completeness Test 2", coarse);
    const result = await getCompleteness(projectId2);
    expect(result.issues).toHaveLength(1);

    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: coarse.toLowerCase() } });
  }, 30000);

  it("route dismisses an issue", async () => {
    await prisma.scopeSplitRule.upsert({
      where: { coarseScope_finerScope: { coarseScope: coarse, finerScope: "Finer A" } },
      create: { coarseScope: coarse, finerScope: "Finer A" },
      update: {},
    });
    await prisma.scopeDictionaryEntry.upsert({
      where: { normalizedName: coarse.toLowerCase() },
      create: { normalizedName: coarse.toLowerCase(), canonicalScope: coarse },
      update: { canonicalScope: coarse },
    });
    const pid = await makeProjectWithActivity("Completeness Route Test", coarse);

    const before = await getCompleteness(pid);
    expect(before.issues).toHaveLength(1);

    const { POST } = await import("@/app/api/completeness/dismiss/route");
    const res = await POST(new Request("http://localhost/api/completeness/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: pid, canonicalActivityKey: before.issues[0].canonicalActivityKey, coarseScope: coarse }),
    }));
    expect(res.status).toBe(200);

    const after = await getCompleteness(pid);
    expect(after.issues).toHaveLength(0);

    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: coarse.toLowerCase() } });
    await prisma.project.delete({ where: { id: pid } });
  }, 30000);

  it("route rejects a missing projectId", async () => {
    const { POST } = await import("@/app/api/completeness/dismiss/route");
    const res = await POST(new Request("http://localhost/api/completeness/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canonicalActivityKey: "x", coarseScope: "y" }),
    }));
    expect(res.status).toBe(422);
  });

  it("reports no import for a project without one", async () => {
    const p = await prisma.project.create({ data: { name: "Completeness No Import Test" } });
    const result = await getCompleteness(p.id);
    expect(result.hasImport).toBe(false);
    expect(result.issues).toEqual([]);
    await prisma.project.delete({ where: { id: p.id } });
  }, 15000);
});
