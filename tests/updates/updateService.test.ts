import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getOrCreateDraft, saveEntries, finalizeUpdate, getFinalizedEntries, type EntryInput } from "@/lib/updates/updateService";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("updateService", () => {
  const projectIds: string[] = [];
  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.$disconnect();
  });

  /** A project with one import holding activities A (uid 1), B (uid 2) and C (uid 3). */
  async function fixture(name: string) {
    const project = await prisma.project.create({ data: { name } });
    projectIds.push(project.id);
    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h" },
    });
    await prisma.activity.createMany({
      data: [[1, "1|a", "A"], [2, "2|b", "B"], [3, "3|c", "C"]].map(([externalUid, canonicalActivityKey, name]) => ({
        scheduleImportId: imp.id, externalUid: externalUid as number, canonicalActivityKey: canonicalActivityKey as string, name: name as string, type: "task",
      })),
    });
    return project.id;
  }
  const entry = (uid: number, key: string, patch: Partial<EntryInput> = {}): EntryInput => ({
    activityExternalUid: uid, canonicalActivityKey: key, status: "in_progress", actualStart: "2026-06-15",
    actualFinish: null, percentComplete: 40, note: null, expectedVersion: null, ...patch,
  });
  const entriesOf = (updateId: string) =>
    prisma.progressEntry.findMany({ where: { progressUpdateId: updateId }, orderBy: { canonicalActivityKey: "asc" } });

  it("saves only the activities sent, removes emptied ones, and records who changed them", async () => {
    const id = (await getOrCreateDraft(await fixture("Merge Test"), "2026-06-18", 3)).id;
    await saveEntries(id, [entry(1, "1|a"), entry(2, "2|b"), entry(3, "3|c", { status: "not_started", actualStart: null, percentComplete: null })], 5);
    let saved = await entriesOf(id);
    expect(saved.map((e) => e.canonicalActivityKey)).toEqual(["1|a", "2|b"]); // not_started with nothing set is dropped
    expect(saved.every((e) => e.changedByPersonId === 5)).toBe(true);

    // Sending only B leaves A untouched.
    const a = saved[0];
    await saveEntries(id, [entry(2, "2|b", { percentComplete: 60, expectedVersion: saved[1].updatedAt.toISOString() })], 6);
    saved = await entriesOf(id);
    expect(saved[0]).toEqual(a);
    expect(saved[1]).toMatchObject({ percentComplete: 60, changedByPersonId: 6 });

    // Emptying B removes its entry.
    await saveEntries(id, [entry(2, "2|b", { status: "not_started", actualStart: null, percentComplete: null, expectedVersion: saved[1].updatedAt.toISOString() })]);
    expect((await entriesOf(id)).map((e) => e.canonicalActivityKey)).toEqual(["1|a"]);
  }, 30000);

  it("refuses the whole save when any row is stale, invalid or outside the import", async () => {
    const id = (await getOrCreateDraft(await fixture("Refuse Test"), "2026-06-18", 3)).id;
    await saveEntries(id, [entry(1, "1|a")]);
    const before = await entriesOf(id);

    // A was saved after this caller loaded it (they think it had no entry).
    await expect(saveEntries(id, [entry(1, "1|a", { percentComplete: 90 }), entry(2, "2|b")]))
      .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/1 activity was changed by someone else.*A\b.*Nothing was saved/) });
    await expect(saveEntries(id, [entry(2, "2|b", { percentComplete: 101 })])).rejects.toMatchObject({ status: 422 });
    await expect(saveEntries(id, [entry(9, "9|z")])).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/not in this update's schedule/) });
    await expect(saveEntries(id, [entry(2, "2|b"), entry(2, "2|b")])).rejects.toMatchObject({ status: 422 });
    expect(await entriesOf(id)).toEqual(before);
  }, 30000);

  it("refuses saves and re-finalize once finalized, and carries finalized entries", async () => {
    const projectId = await fixture("Finalize Test");
    const id = (await getOrCreateDraft(projectId, "2026-06-18", 3)).id;
    await saveEntries(id, [entry(1, "1|a", { status: "complete", actualFinish: "2026-06-17", percentComplete: 100 })]);
    await finalizeUpdate(id);
    await expect(saveEntries(id, [])).rejects.toMatchObject({ status: 409 });
    await expect(finalizeUpdate(id)).rejects.toThrow();

    const finalized = await getFinalizedEntries(projectId);
    expect(finalized.map((e) => e.canonicalActivityKey)).toEqual(["1|a"]);
    expect(finalized[0].finalizedAt).toBeInstanceOf(Date);

    const next = await getOrCreateDraft(projectId, "2026-06-25", 3);
    expect(next.id).not.toBe(id);
  }, 30000);

  it("keeps one open draft per project, even when two starts race", async () => {
    const projectId = await fixture("Race Test");
    const [a, b] = await Promise.all([getOrCreateDraft(projectId, "2026-06-18", 3), getOrCreateDraft(projectId, "2026-06-18", 6)]);
    expect(b.id).toBe(a.id);
    expect(await prisma.progressUpdate.count({ where: { projectId, state: "draft" } })).toBe(1);
  }, 30000);

  it("refuses to start an update when no import exists", async () => {
    const p = await prisma.project.create({ data: { name: "No Import Test" } });
    projectIds.push(p.id);
    await expect(getOrCreateDraft(p.id, "2026-06-18", 3)).rejects.toThrow();
  });

  it("entries route saves a JSON request and returns the refusal status", async () => {
    const { POST } = await import("@/app/api/updates/[updateId]/entries/route");
    const draft = await getOrCreateDraft(await fixture("Route Test"), "2026-06-18", 3);
    const post = (entries: unknown) => POST(
      new Request("http://localhost/api/updates/x/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries }) }),
      { params: Promise.resolve({ updateId: draft.id }) },
    );
    expect((await post([entry(1, "1|a", { percentComplete: 25 })])).status).toBe(200);
    expect((await entriesOf(draft.id))[0].percentComplete).toBe(25);
    const stale = await post([entry(1, "1|a")]);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.message).toMatch(/changed by someone else/);
    expect((await post([{ canonicalActivityKey: 5 }])).status).toBe(422);
  }, 30000);
});
