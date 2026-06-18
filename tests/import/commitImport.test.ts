import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { commitImport, previewImport, toDbDate } from "@/lib/import/commitImport";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");
const hasDb = !!process.env.DATABASE_URL;

describe("toDbDate", () => {
  it("treats naive MSPDI datetimes as UTC wall-clock", () => {
    expect(toDbDate("2025-06-03T08:00:00")?.toISOString()).toBe("2025-06-03T08:00:00.000Z");
    expect(toDbDate(null)).toBeNull();
  });
});

describe("previewImport", () => {
  it("returns counts without touching the DB", () => {
    const p = previewImport(xml);
    expect(p.parsed.counts.activities).toBe(4);
    expect(p.fileHash).toHaveLength(64);
  });
});

describe.runIf(hasDb)("commitImport", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("writes an immutable snapshot with all child rows", async () => {
    const project = await prisma.project.create({ data: { name: "Commit Test" } });
    projectId = project.id;
    const { id } = await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });
    const imp = await prisma.scheduleImport.findUnique({
      where: { id },
      include: { activities: true, relationships: true },
    });
    expect(imp?.activityCount).toBe(4);
    expect(imp?.activities.length).toBe(4);
    expect(imp?.relationships.length).toBe(2);
    expect(imp?.statusDate?.toISOString()).toBe("2025-06-05T17:00:00.000Z");
  });
});
