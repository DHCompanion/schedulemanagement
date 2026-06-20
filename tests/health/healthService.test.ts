import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getScheduleHealth } from "@/lib/health/healthService";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("healthService", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("flags the mis-dated and future-actual activities from the latest import", async () => {
    const project = await prisma.project.create({ data: { name: "Health Service Test" } });
    projectId = project.id;
    const imp = await prisma.scheduleImport.create({
      data: {
        projectId: project.id,
        sourceFormat: "msproject_xml",
        fileName: "x.xml",
        fileHash: "h",
        statusDate: new Date("2026-06-19"),
        projectStart: new Date("2026-01-01"),
        projectFinish: new Date("2026-12-31"),
      },
    });

    const mk = (uid: number, over: Record<string, unknown>) => ({
      scheduleImportId: imp.id,
      externalUid: uid,
      externalId: uid,
      wbsCode: String(uid),
      name: `Task ${uid}`,
      canonicalActivityKey: `${uid}|task`,
      type: "task",
      plannedStart: new Date("2026-04-01"),
      plannedFinish: new Date("2026-04-10"),
      ...over,
    });

    await prisma.activity.createMany({
      data: [
        mk(1, {}),
        mk(2, { plannedStart: new Date("2026-05-01"), plannedFinish: new Date("2026-05-12") }),
        mk(3, { plannedStart: new Date("2026-06-01"), plannedFinish: new Date("2026-06-09") }),
        // mis-dated well before the stored project window
        mk(9, { plannedStart: new Date("2024-06-01"), plannedFinish: new Date("2024-06-05") }),
        // recorded as finished in the future relative to the status date
        mk(10, { actualFinish: new Date("2027-01-01"), percentComplete: 100 }),
      ],
    });

    const health = await getScheduleHealth(project.id);
    expect(health.hasImport).toBe(true);
    expect(health.asOfDate?.getTime()).toBe(new Date("2026-06-19").getTime());
    expect(health.summary.byCheck.out_of_envelope).toBe(1);
    expect(health.summary.byCheck.future_actual).toBe(1);
    expect(health.summary.errors).toBe(2);
    expect(health.summary.warnings).toBe(0);

    const envIssue = health.issues.find((i) => i.check === "out_of_envelope");
    expect(envIssue?.externalId).toBe(9);
    const futureIssue = health.issues.find((i) => i.check === "future_actual");
    expect(futureIssue?.externalId).toBe(10);
  }, 30000);

  it("reports no import for a project without one", async () => {
    const p = await prisma.project.create({ data: { name: "Health No Import Test" } });
    const health = await getScheduleHealth(p.id);
    expect(health.hasImport).toBe(false);
    expect(health.issues).toEqual([]);
    await prisma.project.delete({ where: { id: p.id } });
  }, 15000);
});
