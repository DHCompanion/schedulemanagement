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
        {
          scheduleImportId: imp.id, externalUid: 3, canonicalActivityKey: "3|c", name: "Deferred Scope", type: "task",
          wbsCode: "1.3", plannedStart: new Date("2026-08-17T08:00:00Z"), plannedFinish: new Date("2026-08-21T17:00:00Z"),
          durationDays: 5, isActive: false,
        },
      ],
    });
    await prisma.relationship.create({
      data: { scheduleImportId: imp.id, predecessorExternalUid: 1, successorExternalUid: 2, type: "FS", lagMinutes: 0 },
    });

    const data = await getScheduleData(project.id);
    expect(data).not.toBeNull();
    const [a, b, c] = data!.rows;
    expect(a.status).toBe("in_progress");
    expect(a.driftDays).toBe(4);
    expect(b.status).toBe("not_started");
    expect(b.expectedStart!.slice(0, 10)).toBe("2026-08-14");
    expect(b.driftDays).toBe(4);
    expect(b.pushedByName).toBe("Overhead MEP");
    expect(data!.projectDriftDays).toBe(4);
    expect(data!.atRiskCount).toBe(0);
    expect(data!.statusDate.slice(0, 10)).toBe("2026-08-07");
    // Inactive activities get no forecast entry; expectedStart falls back to planned.
    expect(c.expectedStart).toBe("2026-08-17T08:00:00.000Z");
  });

  it("flags only the specific activity procurement linked, not every activity for that trade partner", async () => {
    const project = await prisma.project.create({ data: { name: "Scoped Risk Test" } });

    const imp = await prisma.scheduleImport.create({
      data: {
        projectId: project.id, sourceFormat: "msproject_xml", fileName: "f.xml", fileHash: "h2",
        statusDate: new Date("2026-08-07T17:00:00Z"), minutesPerDay: 480,
      },
    });
    await prisma.activity.createMany({
      data: [
        {
          scheduleImportId: imp.id, externalUid: 11, canonicalActivityKey: "5.1-set-ahu-1", name: "5.1 Set rooftop AHU-1", type: "task",
          wbsCode: "5.1", plannedStart: new Date("2026-08-03T08:00:00Z"), plannedFinish: new Date("2026-08-07T17:00:00Z"), durationDays: 5,
        },
        {
          scheduleImportId: imp.id, externalUid: 12, canonicalActivityKey: "5.2-set-ahu-2", name: "5.2 Set rooftop AHU-2", type: "task",
          wbsCode: "5.2", plannedStart: new Date("2026-08-03T08:00:00Z"), plannedFinish: new Date("2026-08-07T17:00:00Z"), durationDays: 5,
        },
      ],
    });
    // Same trade partner (osPartnerId 500) is behind, but only AHU-1's item is
    // actually linked to activity 5.1 -- AHU-2's sibling activity must stay clean.
    await prisma.osProcurementRisk.create({
      data: {
        projectId: project.id, osPartnerId: 500, partnerName: "Mechanical Co", itemCount: 2, behindCount: 1,
        submittalLateCount: 1, projectedLateCount: 0, releasedAtRiskCount: 0, missingDatesCount: 0,
        atRiskActivityKeys: ["5.1-set-ahu-1"], leastAdvancedState: "submittal_prep",
        atRiskActivities: [{ activityKey: "5.1-set-ahu-1", requiredOnSite: "2026-09-21T00:00:00.000Z", state: "submitted" }],
      },
    });

    try {
      const data = await getScheduleData(project.id);
      const ahu1 = data!.rows.find((r) => r.wbsCode === "5.1")!;
      const ahu2 = data!.rows.find((r) => r.wbsCode === "5.2")!;
      expect(ahu1.atRisk).toBe(true);
      // The flagged row carries its own linked item's date/state, not the partner aggregate.
      expect(ahu1.atRiskItem).toEqual({ requiredOnSite: "2026-09-21T00:00:00.000Z", state: "submitted" });
      expect(ahu2.atRisk).toBe(false);
      expect(ahu2.atRiskItem).toBeNull();
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  });
});
