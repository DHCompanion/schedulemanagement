import { describe, it, expect, afterAll } from "vitest";
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { saveAgentDraft, type DraftWriteEntry, type DraftWriteInput } from "@/lib/gateway/draftWrite";
import { finalizeUpdate, getOrCreateDraft, saveEntries } from "@/lib/updates/updateService";

const hasDb = !!process.env.DATABASE_URL;
const who = { personId: 7, agentId: "480397a0-2449-432a-abcf-29abe1d90a56", clientKey: "claude" };

describe.runIf(hasDb)("agent draft write", () => {
  const projectIds: string[] = [];
  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.$disconnect();
  });

  /** A Connect-linked project with one import (data date 2026-11-03) holding activities A, B and C. */
  async function fixture(name: string) {
    const osProjectId = randomInt(1_000_000_000, 2_000_000_000);
    const project = await prisma.project.create({ data: { name, osProjectId } });
    projectIds.push(project.id);
    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h", statusDate: new Date("2026-11-03T00:00:00.000Z") },
    });
    await prisma.activity.createMany({
      data: [[1, "1|a", "A"], [2, "2|b", "B"], [3, "3|c", "C"]].map(([externalUid, canonicalActivityKey, n]) => ({
        scheduleImportId: imp.id, externalUid: externalUid as number, canonicalActivityKey: canonicalActivityKey as string, name: n as string, type: "task",
      })),
    });
    return { osProjectId, projectId: project.id };
  }
  const entry = (key: string, patch: Partial<DraftWriteEntry> = {}): DraftWriteEntry => ({
    key, status: "in_progress", percentComplete: 40, actualStart: "2026-11-02", actualFinish: null, expectedDraft: null, ...patch,
  });
  let n = 0;
  const input = (patch: Partial<DraftWriteInput> = {}): DraftWriteInput => ({
    projectId: 1, idempotencyKey: `key-${++n}-abcdefgh`, expectedDraftAsOfDate: null, entries: [], ...patch,
  });
  const draftOf = (projectId: string) => prisma.progressUpdate.findFirst({ where: { projectId, state: "draft" }, include: { entries: { orderBy: { canonicalActivityKey: "asc" } } } });

  it("creates the draft at the schedule's data date and saves for the person; a resend saves once", async () => {
    const { osProjectId, projectId } = await fixture("Agent Create");
    const write = input({ entries: [entry("1|a"), entry("2|b", { status: "complete", percentComplete: 100, actualFinish: "2026-11-03" })] });
    expect(await saveAgentDraft(osProjectId, write, who)).toEqual({ saved: true, asOfDate: "2026-11-03", activities: ["1|a", "2|b"], reason: null, message: null });
    const draft = (await draftOf(projectId))!;
    expect(draft.personId).toBe(7);
    expect(draft.entries.map((e) => [e.canonicalActivityKey, e.percentComplete, e.changedByPersonId])).toEqual([["1|a", 40, 7], ["2|b", 100, 7]]);
    // Same key and payload: the first answer, nothing saved again.
    expect((await saveAgentDraft(osProjectId, write, who)).saved).toBe(true);
    expect(await prisma.agentWrite.count({ where: { progressUpdateId: draft.id } })).toBe(1);
    // Same key, different payload: refused.
    expect(await saveAgentDraft(osProjectId, { ...write, entries: [entry("1|a", { percentComplete: 90 })] }, who)).toMatchObject({ saved: false, reason: "invalid" });
  }, 30000);

  it("moves the data date, and refuses if the draft date or any entry changed since the agent read it", async () => {
    const { osProjectId, projectId } = await fixture("Agent Stale");
    const draftId = (await getOrCreateDraft(projectId, "2026-11-03", 3)).id;
    await saveEntries(draftId, [{ activityExternalUid: 1, canonicalActivityKey: "1|a", status: "in_progress", actualStart: "2026-11-02", actualFinish: null, percentComplete: 20, note: "crane Tuesday", forecastFinish: "2026-11-20", expectedVersion: null }], 3);
    const read = { status: "in_progress", percentComplete: 20, actualStart: "2026-11-02", actualFinish: null };

    // The agent read no draft (or another date): refused, nothing changes.
    expect(await saveAgentDraft(osProjectId, input({ entries: [entry("1|a", { expectedDraft: read })] }), who)).toMatchObject({ saved: false, reason: "stale", asOfDate: "2026-11-03" });
    // The agent read A at 10%, but it is 20% now.
    expect(await saveAgentDraft(osProjectId, input({ expectedDraftAsOfDate: "2026-11-03", entries: [entry("1|a", { expectedDraft: { ...read, percentComplete: 10 } }), entry("2|b")] }), who))
      .toMatchObject({ saved: false, reason: "stale", activities: ["1|a"] });
    expect((await draftOf(projectId))!.entries).toHaveLength(1);

    // Read matches: date moves and A updates, keeping its note and forecast.
    expect(await saveAgentDraft(osProjectId, input({ asOfDate: "2026-11-07", expectedDraftAsOfDate: "2026-11-03", entries: [entry("1|a", { percentComplete: 60, expectedDraft: read })] }), who))
      .toMatchObject({ saved: true, asOfDate: "2026-11-07" });
    const draft = (await draftOf(projectId))!;
    expect(draft.asOfDate.toISOString().slice(0, 10)).toBe("2026-11-07");
    expect(draft.entries[0]).toMatchObject({ percentComplete: 60, note: "crane Tuesday", changedByPersonId: 7 });
    expect(draft.entries[0].forecastFinish?.toISOString().slice(0, 10)).toBe("2026-11-20");
    const record = await prisma.agentWrite.findFirst({ where: { progressUpdateId: draft.id } });
    expect(record?.fromAsOfDate?.toISOString().slice(0, 10)).toBe("2026-11-03");
  }, 30000);

  it("enforces the data date rules and the import's activities", async () => {
    const { osProjectId, projectId } = await fixture("Agent Rules");
    const first = (await getOrCreateDraft(projectId, "2026-10-27", 3)).id;
    await finalizeUpdate(first);
    // Not after the last finalized update.
    expect(await saveAgentDraft(osProjectId, input({ asOfDate: "2026-10-27" }), who)).toMatchObject({ saved: false, reason: "invalid", message: expect.stringMatching(/2026-10-27/) });
    // No actual date after the data date, sent now...
    expect(await saveAgentDraft(osProjectId, input({ asOfDate: "2026-11-03", entries: [entry("1|a", { actualStart: "2026-11-05" })] }), who)).toMatchObject({ saved: false, reason: "invalid", activities: ["1|a"] });
    expect(await draftOf(projectId)).toBeNull();
    // ...or already in the draft when the date moves back.
    expect((await saveAgentDraft(osProjectId, input({ asOfDate: "2026-11-07", entries: [entry("2|b", { actualStart: "2026-11-06" })] }), who)).saved).toBe(true);
    expect(await saveAgentDraft(osProjectId, input({ asOfDate: "2026-11-03", expectedDraftAsOfDate: "2026-11-07" }), who)).toMatchObject({ saved: false, reason: "invalid", activities: ["2|b"] });
    // Unknown activity and a bad date.
    expect(await saveAgentDraft(osProjectId, input({ expectedDraftAsOfDate: "2026-11-07", entries: [entry("9|z")] }), who)).toMatchObject({ saved: false, reason: "invalid", activities: ["9|z"] });
    expect(await saveAgentDraft(osProjectId, input({ asOfDate: "2026-13-40", expectedDraftAsOfDate: "2026-11-07" }), who)).toMatchObject({ saved: false, reason: "invalid" });
    // An in-progress activity still needs its actual start (the form's own rules apply).
    expect(await saveAgentDraft(osProjectId, input({ expectedDraftAsOfDate: "2026-11-07", entries: [entry("3|c", { actualStart: null })] }), who)).toMatchObject({ saved: false, reason: "invalid" });
  }, 30000);

  it("runs overlapping writes one at a time: a newer date is never undone, and a racing resend gets the first answer", async () => {
    const { osProjectId, projectId } = await fixture("Agent Race");
    await getOrCreateDraft(projectId, "2026-11-03", 3);
    // Two writes from the same read: one wins, the other is stale, and the winner's date stands.
    const [a, b] = await Promise.all([
      saveAgentDraft(osProjectId, input({ asOfDate: "2026-11-06", expectedDraftAsOfDate: "2026-11-03" }), who),
      saveAgentDraft(osProjectId, input({ asOfDate: "2026-11-07", expectedDraftAsOfDate: "2026-11-03", entries: [entry("2|b")] }), who),
    ]);
    expect([a.saved, b.saved].sort()).toEqual([false, true]);
    const won = a.saved ? a : b;
    expect((a.saved ? b : a).reason).toBe("stale");
    const draft = (await draftOf(projectId))!;
    expect(draft.asOfDate.toISOString().slice(0, 10)).toBe(won.asOfDate);
    // The same write sent twice at once: both answers say saved, and it is recorded once.
    const write = input({ expectedDraftAsOfDate: won.asOfDate, entries: [entry("1|a")] });
    const both = await Promise.all([saveAgentDraft(osProjectId, write, who), saveAgentDraft(osProjectId, write, who)]);
    expect(both.map((r) => r.saved)).toEqual([true, true]);
    expect(await prisma.agentWrite.count({ where: { progressUpdateId: draft.id, idempotencyKey: write.idempotencyKey } })).toBe(1);
  }, 30000);

  it("answers no_schedule for a project with nothing linked", async () => {
    expect(await saveAgentDraft(2_100_000_000, input(), who)).toMatchObject({ saved: false, reason: "no_schedule" });
  });
});
