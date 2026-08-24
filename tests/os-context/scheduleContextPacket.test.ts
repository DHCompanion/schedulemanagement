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
    // When set, seeds a WBS ancestor row (outlineLevel 1, outlineNumber "1")
    // above the leaf (outlineLevel 2, outlineNumber "1.1") so phaseByActivityId
    // resolves this name as the leaf's phase. Omitted: leaf keeps the schema
    // defaults (outlineLevel 0, outlineNumber null), phase resolves to null.
    phaseName?: string;
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

    if (options.phaseName) {
      // A real top-level WBS phase group: type "summary", outlineLevel/
      // outlineNumber precede the leaf's, so phaseByActivityId's ancestor
      // stack (built from the full activity set, summaries included) resolves
      // this as the leaf's phase.
      await prisma.activity.create({
        data: {
          canonicalActivityKey: `0|${options.phaseName.toLowerCase()}`,
          externalUid: 0,
          isActive: true,
          isSummary: true,
          name: options.phaseName,
          outlineLevel: 1,
          outlineNumber: "1",
          scheduleImportId: scheduleImport.id,
          type: "summary",
        },
      });
    }

    await prisma.activity.create({
      data: {
        canonicalActivityKey: `1|${options.activityName.toLowerCase()}`,
        externalUid: 1,
        isCritical: options.isCritical ?? false,
        name: options.activityName,
        outlineLevel: options.phaseName ? 2 : 0,
        outlineNumber: options.phaseName ? "1.1" : null,
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

  it("summarizes week buckets from the forecast layer", async () => {
    // 830000 offset: 800000/810000/820000 are already used by the tests above
    // (same stamp), and colliding on osProjectId's unique constraint would be
    // a false-negative failure unrelated to weekBuckets.
    const osProjectId = 830000 + (stamp % 1000);
    const project = await prisma.project.create({
      data: { name: `os-context buckets ${osProjectId}`, osProjectId },
    });
    createdProjectIds.push(project.id);
    const imp = await prisma.scheduleImport.create({
      data: {
        projectId: project.id, sourceFormat: "msproject_xml", fileName: "s.xml", fileHash: `hb-${project.id}`,
        statusDate: new Date("2026-08-07T17:00:00Z"), minutesPerDay: 480,
      },
    });
    // Same chain fixture as tests/schedule/scheduleRows.test.ts: A 20% in
    // progress at the Aug 7 status date (+4d), B FS-pushed to Fri Aug 14.
    await prisma.activity.createMany({
      data: [
        {
          scheduleImportId: imp.id, externalUid: 1, canonicalActivityKey: `1|zzbucket-a-${stamp}`, name: "A", type: "task",
          plannedStart: new Date("2026-08-03T08:00:00Z"), plannedFinish: new Date("2026-08-07T17:00:00Z"),
          durationDays: 5, percentComplete: 20, actualStart: new Date("2026-08-03T08:00:00Z"),
        },
        {
          scheduleImportId: imp.id, externalUid: 2, canonicalActivityKey: `2|zzbucket-b-${stamp}`, name: "B", type: "task",
          plannedStart: new Date("2026-08-10T08:00:00Z"), plannedFinish: new Date("2026-08-14T17:00:00Z"),
          durationDays: 5,
        },
      ],
    });
    await prisma.relationship.create({
      data: { scheduleImportId: imp.id, predecessorExternalUid: 1, successorExternalUid: 2, type: "FS", lagMinutes: 0 },
    });

    const packet = await buildScheduleContextPacket(osProjectId, 25);
    const wb = packet.summary.weekBuckets as Record<
      string,
      { count: number; cards: { name: string; driftDays: number; partnerName: string | null }[] }
    >;
    expect(wb.thisWeek.count).toBe(1); // A is in progress -> this week
    expect(wb.thisWeek.cards[0].name).toBe("A");
    expect(wb.thisWeek.cards[0].driftDays).toBe(4);
    // asOf Fri Aug 7 -> week0 = Mon Aug 3; B's expected start Fri Aug 14 lands in week0+1.
    expect(wb.nextWeek.count).toBe(1);
    expect(wb.nextWeek.cards[0].name).toBe("B");
    expect(wb.nextWeek.cards[0].partnerName).toBeNull();
    expect(wb.done).toEqual({ count: 0, cards: [] });
  });

  it("nests scopeGroups and leaf activities under the partner row", async () => {
    const osProjectId = 970000 + (stamp % 1000);
    const phaseName = `zz-phase-${stamp}`;
    await seedProject({
      osProjectId,
      activityName: `${scopeName} rough-in`,
      canonicalScope: scopeName,
      osDisciplineId: disciplineId,
      osPartnerId: 4242,
      partnerName: "Test Electrical",
      plannedStart: new Date("2026-05-04T00:00:00.000Z"),
      phaseName,
    });
    const packet = await buildScheduleContextPacket(osProjectId, 25);
    const row = packet.items.find((i) => i.osPartnerId === 4242);
    expect(row).toBeDefined();
    expect(row!.scopeGroups.length).toBeGreaterThanOrEqual(1);
    const group = row!.scopeGroups[0];
    expect(group.canonicalScope).toBe(scopeName);
    expect(group.firstActivityStart).toBe("2026-05-04T00:00:00.000Z");
    expect(group.phase).toBe(phaseName);
    expect(row!.activities.length).toBeGreaterThanOrEqual(1);
    expect(row!.activities[0].canonicalScope).toBe(scopeName);
    expect(row!.activities.find((a) => a.canonicalScope === scopeName)!.phase).toBe(phaseName);
  });
});
