import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getScheduleData } from "@/lib/schedule/scheduleRows";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("getScheduleData", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("returns null with no import and assembles forecast-carrying rows from a pushed chain", async () => {
    const project = await prisma.project.create({ data: { name: "Schedule Rows Test" } });
    projectId = project.id;
    expect(await getScheduleData(project.id)).toBeNull();

    const imp = await prisma.scheduleImport.create({
      data: {
        projectId: project.id, sourceFormat: "msproject_xml", fileName: "f.xml", fileHash: "h",
        statusDate: new Date("2026-08-07T17:00:00Z"), minutesPerDay: 480,
      },
    });
    await prisma.activity.createMany({
      data: [
        {
          scheduleImportId: imp.id, externalUid: 1, canonicalActivityKey: "1|a", name: "Overhead MEP", type: "task",
          wbsCode: "1.1", plannedStart: new Date("2026-08-03T08:00:00Z"), plannedFinish: new Date("2026-08-07T17:00:00Z"),
          durationDays: 5, percentComplete: 20, actualStart: new Date("2026-08-03T08:00:00Z"),
        },
        {
          scheduleImportId: imp.id, externalUid: 2, canonicalActivityKey: "2|b", name: "In-Wall Rough-In", type: "task",
          wbsCode: "1.2", plannedStart: new Date("2026-08-10T08:00:00Z"), plannedFinish: new Date("2026-08-14T17:00:00Z"),
          durationDays: 5,
        },
      ],
    });
    await prisma.relationship.create({
      data: { scheduleImportId: imp.id, predecessorExternalUid: 1, successorExternalUid: 2, type: "FS", lagMinutes: 0 },
    });

    const data = await getScheduleData(project.id);
    expect(data).not.toBeNull();
    const [a, b] = data!.rows;
    expect(a.status).toBe("in_progress");
    expect(a.driftDays).toBe(4);
    expect(b.status).toBe("not_started");
    expect(b.expectedStart!.slice(0, 10)).toBe("2026-08-14");
    expect(b.driftDays).toBe(4);
    expect(b.pushedByName).toBe("Overhead MEP");
    expect(data!.projectDriftDays).toBe(4);
    expect(data!.atRiskCount).toBe(0);
    expect(data!.statusDate.slice(0, 10)).toBe("2026-08-07");
  });
});
