import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { changeDraftDate, discardDraft, finalizeUpdate, getOrCreateDraft, saveEntries } from "@/lib/updates/updateService";
import { saveAgentDraft } from "@/lib/gateway/draftWrite";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("person draft date and discard", () => {
  const projectIds: string[] = [];
  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.$disconnect();
  });

  /** A project with one import holding activities A and B, a finalized update at 2026-10-27, and an open draft at 2026-11-03. */
  async function fixture(name: string) {
    const project = await prisma.project.create({ data: { name, osProjectId: Math.floor(1_000_000_000 + Math.random() * 1_000_000_000) } });
    projectIds.push(project.id);
    const imp = await prisma.scheduleImport.create({ data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h", statusDate: new Date("2026-10-27T00:00:00.000Z") } });
    await prisma.activity.createMany({ data: [[1, "1|a", "Set AHU-1"], [2, "2|b", "Pour slab"]].map(([externalUid, canonicalActivityKey, n]) => ({ scheduleImportId: imp.id, externalUid: externalUid as number, canonicalActivityKey: canonicalActivityKey as string, name: n as string, type: "task" })) });
    await finalizeUpdate((await getOrCreateDraft(project.id, "2026-10-27", 3)).id);
    const draftId = (await getOrCreateDraft(project.id, "2026-11-03", 3)).id;
    return { project, draftId };
  }
  const asOf = async (id: string) => (await prisma.progressUpdate.findUnique({ where: { id } }))?.asOfDate.toISOString().slice(0, 10);

  it("moves the draft's data date, under the same rules as the agent write", async () => {
    const { draftId } = await fixture("Person Date");
    await saveEntries(draftId, [{ activityExternalUid: 1, canonicalActivityKey: "1|a", status: "in_progress", actualStart: "2026-11-02", actualFinish: null, percentComplete: 20, note: null, expectedVersion: null }], 3);
    await changeDraftDate(draftId, "2026-11-07");
    expect(await asOf(draftId)).toBe("2026-11-07");
    // Not on or before the last finalized update.
    await expect(changeDraftDate(draftId, "2026-10-27")).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/2026-10-27/) });
    // No actual date after the data date: names the activity.
    await expect(changeDraftDate(draftId, "2026-11-01")).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/Set AHU-1/) });
    await expect(changeDraftDate(draftId, "2026-13-40")).rejects.toMatchObject({ status: 422 });
    expect(await asOf(draftId)).toBe("2026-11-07");
    await finalizeUpdate(draftId);
    await expect(changeDraftDate(draftId, "2026-11-10")).rejects.toMatchObject({ status: 409 });
  }, 30000);

  it("discards an open draft with its entries, keeping agent write keys so a late resend can't bring it back; never a finalized update", async () => {
    const { project, draftId } = await fixture("Person Discard");
    const who = { personId: 7, agentId: `a-${draftId}`, clientKey: "claude" };
    const write = { projectId: 1, idempotencyKey: "discard-key-0001", expectedDraftAsOfDate: "2026-11-03", entries: [{ key: "2|b", status: "in_progress", percentComplete: 10, actualStart: "2026-11-02", actualFinish: null, expectedDraft: null }] };
    const first = await saveAgentDraft(project.osProjectId!, write, who);
    expect(first.saved).toBe(true);
    await discardDraft(draftId);
    expect(await prisma.progressUpdate.findUnique({ where: { id: draftId } })).toBeNull();
    expect(await prisma.progressEntry.count({ where: { progressUpdateId: draftId } })).toBe(0);
    // The resend gets its first answer; the discarded draft stays gone.
    expect(await saveAgentDraft(project.osProjectId!, write, who)).toEqual(first);
    expect(await prisma.progressUpdate.count({ where: { projectId: project.id, state: "draft" } })).toBe(0);
    await prisma.agentWrite.deleteMany({ where: { agentId: who.agentId } });
    const finalized = (await prisma.progressUpdate.findFirst({ where: { projectId: project.id, state: "finalized" } }))!;
    await expect(discardDraft(finalized.id)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.progressUpdate.findUnique({ where: { id: finalized.id } })).not.toBeNull();
  }, 30000);

  it("starts a new draft only after the last finalized update", async () => {
    const { project, draftId } = await fixture("Person Start");
    await discardDraft(draftId);
    await expect(getOrCreateDraft(project.id, "2026-10-27", 3)).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/2026-10-27/) });
    expect(await asOf((await getOrCreateDraft(project.id, "2026-10-28", 3)).id)).toBe("2026-10-28");
  }, 30000);
});
