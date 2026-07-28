import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { buildScheduleContextPacket } from "@/lib/os-context/scheduleContextPacket";

const hasDb = !!process.env.DATABASE_URL;

// Integration, not mocked: the packet's whole job is a scoped query across four
// tables, and a mock would assert the query I wrote rather than the one that runs.
describe.runIf(hasDb)("buildScheduleContextPacket", () => {
  const stamp = Date.now();
  const scopeName = `zz-drywall-${stamp}`;
  const otherScopeName = `zz-steel-${stamp}`;
  const disciplineId = 900000 + (stamp % 1000);
  const otherDisciplineId = disciplineId + 1;
  const createdProjectIds: string[] = [];

  afterAll(async () => {
    for (const id of createdProjectIds) {
      await prisma.project.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.scopeDictionaryEntry.deleteMany({ where: { canonicalScope: { in: [scopeName, otherScopeName] } } });
    await prisma.tradeDictionaryEntry.deleteMany({ where: { canonicalScope: { in: [scopeName, otherScopeName] } } });
    await prisma.$disconnect();
  });

  async function seedProject(options: {
    osProjectId: number;
    activityName: string;
    canonicalScope: string;
    osDisciplineId: number;
    osPartnerId: number;
    partnerName: string;
    plannedStart: Date;
    isCritical?: boolean;
  }) {
    const project = await prisma.project.create({
      data: { name: `os-context ${options.osProjectId}`, osProjectId: options.osProjectId },
    });
    createdProjectIds.push(project.id);

    const scheduleImport = await prisma.scheduleImport.create({
      data: {
        fileHash: `h-${project.id}`,
        fileName: "s.xml",
        minutesPerDay: 480,
        projectId: project.id,
        sourceFormat: "msproject_xml",
      },
    });

    await prisma.activity.create({
      data: {
        canonicalActivityKey: `1|${options.activityName.toLowerCase()}`,
        externalUid: 1,
        isCritical: options.isCritical ?? false,
        name: options.activityName,
        plannedFinish: new Date(options.plannedStart.getTime() + 5 * 86400000),
        plannedStart: options.plannedStart,
        scheduleImportId: scheduleImport.id,
        totalSlackMinutes: 960,
        type: "task",
      },
    });

    await prisma.osTradePartner.create({
      data: {
        disciplines: [{ division: "", id: options.osDisciplineId, name: "Trade" }],
        name: options.partnerName,
        osPartnerId: options.osPartnerId,
        projectId: project.id,
      },
    });

    await prisma.projectTradeAssignment.create({
      data: {
        osDisciplineId: options.osDisciplineId,
        osPartnerId: options.osPartnerId,
        partnerName: options.partnerName,
        projectId: project.id,
      },
    });

    // Name -> canonical scope, then scope -> OS discipline. Both dictionaries are
    // global, which is exactly why the cross-project test below matters.
    await prisma.scopeDictionaryEntry.upsert({
      create: { canonicalScope: options.canonicalScope, normalizedName: options.activityName.toLowerCase() },
      update: { canonicalScope: options.canonicalScope },
      where: { normalizedName: options.activityName.toLowerCase() },
    });
    await prisma.tradeDictionaryEntry.upsert({
      create: {
        canonicalScope: options.canonicalScope,
        disciplineName: "Trade",
        osDisciplineId: options.osDisciplineId,
      },
      update: { osDisciplineId: options.osDisciplineId },
      where: { canonicalScope: options.canonicalScope },
    });

    return project.id;
  }

  it("rolls scheduled work up to one row per trade partner", async () => {
    const osProjectId = 800000 + (stamp % 1000);
    await seedProject({
      activityName: `Hang Drywall ${stamp}`,
      canonicalScope: scopeName,
      isCritical: true,
      osDisciplineId: disciplineId,
      osPartnerId: 5001,
      osProjectId,
      partnerName: "Acme Drywall",
      plannedStart: new Date("2026-09-01T00:00:00.000Z"),
    });

    const packet = await buildScheduleContextPacket(osProjectId, 10);

    expect(packet.packetType).toBe("project_schedule_summary");
    expect(packet.projectId).toBe(osProjectId);
    expect(packet.items).toHaveLength(1);
    expect(packet.items[0]).toMatchObject({
      activityCount: 1,
      isCritical: true,
      osPartnerId: 5001,
      partnerName: "Acme Drywall",
      projectId: osProjectId,
    });
    expect(packet.items[0].firstActivityStart).toBe("2026-09-01T00:00:00.000Z");
    // 960 slack minutes over a 480-minute day.
    expect(packet.items[0].minFloatDays).toBe(2);
  });

  // The scoping obligation from EXTERNAL_TOOL_CONTEXT_ENDPOINT.md §4. The scope
  // and trade dictionaries are global tables, so a query that forgot to filter by
  // project would happily pick up another project's activities.
  it("never returns another project's activities", async () => {
    const mineOsId = 810000 + (stamp % 1000);
    const theirsOsId = 820000 + (stamp % 1000);

    await seedProject({
      activityName: `Erect Steel ${stamp}`,
      canonicalScope: otherScopeName,
      osDisciplineId: otherDisciplineId,
      osPartnerId: 6001,
      osProjectId: mineOsId,
      partnerName: "Mine Steel",
      plannedStart: new Date("2026-10-01T00:00:00.000Z"),
    });
    await seedProject({
      activityName: `Erect Steel ${stamp}`,
      canonicalScope: otherScopeName,
      osDisciplineId: otherDisciplineId,
      osPartnerId: 6002,
      osProjectId: theirsOsId,
      partnerName: "Theirs Steel",
      plannedStart: new Date("2026-08-01T00:00:00.000Z"),
    });

    const packet = await buildScheduleContextPacket(mineOsId, 10);

    expect(packet.items.map((item) => item.osPartnerId)).toEqual([6001]);
    expect(packet.items.every((item) => item.projectId === mineOsId)).toBe(true);
    // Theirs starts earlier, so it would sort first if it leaked in.
    expect(packet.items.some((item) => item.partnerName === "Theirs Steel")).toBe(false);
  });

  it("returns an empty packet with a warning when no project is linked", async () => {
    const packet = await buildScheduleContextPacket(999999999, 10);

    expect(packet.items).toEqual([]);
    expect(packet.warnings[0]).toContain("linked");
  });
});
