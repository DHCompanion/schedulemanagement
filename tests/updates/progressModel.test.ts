import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("progress tables", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("creates an update with an entry and cascades on delete", async () => {
    const project = await prisma.project.create({ data: { name: "Progress Model Test" } });
    projectId = project.id;
    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h" },
    });
    const upd = await prisma.progressUpdate.create({
      data: { projectId: project.id, scheduleImportId: imp.id, asOfDate: new Date("2026-06-18T00:00:00Z") },
    });
    await prisma.progressEntry.create({
      data: { progressUpdateId: upd.id, activityExternalUid: 1, canonicalActivityKey: "1|task", status: "in_progress", percentComplete: 50 },
    });
    const found = await prisma.progressUpdate.findUnique({ where: { id: upd.id }, include: { entries: true } });
    expect(found?.state).toBe("draft");
    expect(found?.entries.length).toBe(1);
    expect(found?.entries[0].percentComplete).toBe(50);

    await prisma.progressUpdate.delete({ where: { id: upd.id } });
    const orphans = await prisma.progressEntry.findMany({ where: { progressUpdateId: upd.id } });
    expect(orphans.length).toBe(0);
  });
});
