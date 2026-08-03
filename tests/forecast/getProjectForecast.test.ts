import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getProjectForecast } from "@/lib/forecast/getProjectForecast";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("getProjectForecast", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("returns null with no import, and forecasts a pushed chain from real rows", async () => {
    const project = await prisma.project.create({ data: { name: "Forecast Loader Test" } });
    projectId = project.id;
    expect(await getProjectForecast(project.id)).toBeNull();

    const imp = await prisma.scheduleImport.create({
      data: {
        projectId: project.id, sourceFormat: "msproject_xml", fileName: "f.xml", fileHash: "h",
        statusDate: new Date("2026-08-07T17:00:00Z"), minutesPerDay: 480,
      },
    });
    // A: Mon Aug 3 – Fri Aug 7, 5d, 20% in progress. B: Mon Aug 10 – Fri Aug 14, 5d, FS after A.
    await prisma.activity.createMany({
      data: [
        {
          scheduleImportId: imp.id, externalUid: 1, canonicalActivityKey: "1|a", name: "A", type: "task",
          plannedStart: new Date("2026-08-03T08:00:00Z"), plannedFinish: new Date("2026-08-07T17:00:00Z"),
          durationDays: 5, percentComplete: 20, actualStart: new Date("2026-08-03T08:00:00Z"),
        },
        {
          scheduleImportId: imp.id, externalUid: 2, canonicalActivityKey: "2|b", name: "B", type: "task",
          plannedStart: new Date("2026-08-10T08:00:00Z"), plannedFinish: new Date("2026-08-14T17:00:00Z"),
          durationDays: 5,
        },
      ],
    });
    await prisma.relationship.create({
      data: { scheduleImportId: imp.id, predecessorExternalUid: 1, successorExternalUid: 2, type: "FS", lagMinutes: 0 },
    });

    const result = await getProjectForecast(project.id);
    expect(result).not.toBeNull();
    // A seeds in-progress from imported actuals: 20% at the Aug 7 status date → +4d; B pushed +4d.
    expect(result!.forecastsByUid.get(1)!.driftDays).toBe(4);
    expect(result!.forecastsByUid.get(2)!.driftDays).toBe(4);
    expect(result!.forecastsByUid.get(2)!.pushedByUid).toBe(1);
    expect(result!.project).toEqual({ driftDays: 4, activityUid: 2 });
    expect(result!.statusDate.toISOString()).toBe("2026-08-07T17:00:00.000Z");
  });
});
