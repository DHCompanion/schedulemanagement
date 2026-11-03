import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { commitImport } from "@/lib/import/commitImport";
import { loadUpdateState, toResult } from "@/lib/gateway/updateState";

const xml = readFileSync(resolve(__dirname, "fixtures/minimal.xml"), "utf8");
const hasDb = !!process.env.DATABASE_URL;

// The loader against a real schema: scoped through osProjectId, the draft's edits ride along, nothing linked is empty.
describe.runIf(hasDb)("gateway update-state loader", () => {
  const created: string[] = [];
  const osProjectId = 900_000 + (Date.now() % 90_000);
  afterAll(async () => {
    for (const id of created) await prisma.project.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });

  it("reads the lookahead as of a date, late first, with the open draft's entry", async () => {
    const project = await prisma.project.create({ data: { name: `ZZ Gateway Read ${Date.now()}`, osProjectId } });
    created.push(project.id);
    const imp = await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });
    const rough = await prisma.activity.findFirstOrThrow({ where: { scheduleImportId: imp.id, name: "Electrical Rough-In" } });
    await prisma.progressUpdate.create({ data: { projectId: project.id, scheduleImportId: imp.id, asOfDate: new Date("2025-06-05T00:00:00.000Z"), lookaheadWeeks: 1, state: "draft",
      entries: { create: [{ activityExternalUid: rough.externalUid, canonicalActivityKey: rough.canonicalActivityKey, status: "in_progress", percentComplete: 50, actualStart: new Date("2025-06-04T00:00:00.000Z"), note: "private" }] } } });

    const src = await loadUpdateState(osProjectId, { asOfDate: "2025-06-05" });
    expect(src.weeks).toBe(1);
    const data = toResult(src, () => true);
    expect(data).toMatchObject({ asOfDate: "2025-06-05", lookaheadWeeks: 1, draftUpdate: { asOfDate: "2025-06-05", lookaheadWeeks: 1, entryCount: 1 } });
    expect(data.scheduleImportedAt).not.toBeNull();
    const byKey = new Map(data.activities.map((a) => [a.key, a]));
    // Mobilize is complete in the import, so it is out. Rough-In was planned to start 06-04 and has no committed
    // start (the draft's is not finalized): it should have started, so it is late and sorts first.
    expect(data.activities.map((a) => a.name)).not.toContain("Mobilize");
    expect(data.activities[0]).toMatchObject({ name: "Electrical Rough-In", slippage: "should-have-started", dueByDataDate: true });
    expect(byKey.get(rough.canonicalActivityKey)).toMatchObject({ status: "not_started", draft: { status: "in_progress", percentComplete: 50, actualStart: "2025-06-04", actualFinish: null } });
    expect(JSON.stringify(data)).not.toContain("private");
    expect(data.counts.late).toBeGreaterThanOrEqual(1);
  });

  it("answers an unlinked Connect project as empty", async () => {
    const data = toResult(await loadUpdateState(osProjectId + 1, { asOfDate: "2025-06-05", lookaheadWeeks: 3 }), () => true);
    expect(data).toEqual({ asOfDate: "2025-06-05", lookaheadWeeks: 3, scheduleImportedAt: null, lastFinalizedAsOf: null, draftUpdate: null, counts: { lookahead: 0, due: 0, late: 0 }, activities: [], truncated: false });
  });
});
