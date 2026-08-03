import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getDataHealthCounts } from "@/lib/health/dataHealthCounts";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("getDataHealthCounts", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("is all zeros with no import, and counts an unmapped name after one", async () => {
    const project = await prisma.project.create({ data: { name: "Data Health Counts Test" } });
    projectId = project.id;
    expect(await getDataHealthCounts(project.id)).toEqual({ naming: 0, granularity: 0, trades: 0, total: 0 });

    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h" },
    });
    // A name no shared dictionary will ever map — counts as one naming item.
    await prisma.activity.create({
      data: {
        scheduleImportId: imp.id, externalUid: 1, canonicalActivityKey: "1|zz",
        name: "zz-dhc-test-unmappable-scope-7f3a", type: "task",
      },
    });

    const counts = await getDataHealthCounts(project.id);
    expect(counts.naming).toBe(1);
    // Unmapped name -> its scope never resolves -> it cannot create a trades item.
    expect(counts.trades).toBe(0);
    expect(counts.total).toBe(counts.naming + counts.granularity + counts.trades);
  });
});
