import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getOrCreateDraft, saveEntries, finalizeUpdate, getFinalizedEntries } from "@/lib/updates/updateService";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("updateService", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("runs the draft -> save -> finalize lifecycle and enforces invariants", async () => {
    const project = await prisma.project.create({ data: { name: "Update Service Test" } });
    projectId = project.id;
    await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h" },
    });

    // one-draft-per-project: two calls return the same id
    const d1 = await getOrCreateDraft(project.id, "2026-06-18", 3);
    const d2 = await getOrCreateDraft(project.id, "2026-06-18", 6);
    expect(d2.id).toBe(d1.id);

    // touched-only: a default not_started entry is dropped, a real one is kept
    await saveEntries(d1.id, [
      { activityExternalUid: 1, canonicalActivityKey: "1|a", status: "in_progress", actualStart: "2026-06-15", actualFinish: null, percentComplete: 40, note: null },
      { activityExternalUid: 2, canonicalActivityKey: "2|b", status: "not_started", actualStart: null, actualFinish: null, percentComplete: null, note: null },
    ]);
    const afterSave = await prisma.progressEntry.findMany({ where: { progressUpdateId: d1.id } });
    expect(afterSave.length).toBe(1);
    expect(afterSave[0].canonicalActivityKey).toBe("1|a");

    // re-saving replaces entries
    await saveEntries(d1.id, [
      { activityExternalUid: 1, canonicalActivityKey: "1|a", status: "complete", actualStart: "2026-06-15", actualFinish: "2026-06-17", percentComplete: 100, note: "done" },
    ]);
    const afterResave = await prisma.progressEntry.findMany({ where: { progressUpdateId: d1.id } });
    expect(afterResave.length).toBe(1);
    expect(afterResave[0].status).toBe("complete");

    // finalize, then both save and re-finalize are rejected
    await finalizeUpdate(d1.id);
    await expect(saveEntries(d1.id, [])).rejects.toThrow();
    await expect(finalizeUpdate(d1.id)).rejects.toThrow();

    // finalized entries are queryable for the overlay
    const finalized = await getFinalizedEntries(project.id);
    expect(finalized.length).toBe(1);
    expect(finalized[0].canonicalActivityKey).toBe("1|a");
    expect(finalized[0].finalizedAt).toBeInstanceOf(Date);

    // a fresh draft can start once the prior is finalized
    const d3 = await getOrCreateDraft(project.id, "2026-06-25", 3);
    expect(d3.id).not.toBe(d1.id);
  }, 30000); // many sequential round-trips over Railway's public proxy; in-region latency is far lower

  it("refuses to start an update when no import exists", async () => {
    const p = await prisma.project.create({ data: { name: "No Import Test" } });
    await expect(getOrCreateDraft(p.id, "2026-06-18", 3)).rejects.toThrow();
    await prisma.project.delete({ where: { id: p.id } });
  });

  it("entries route handler saves via a JSON request", async () => {
    const { POST } = await import("@/app/api/updates/[updateId]/entries/route");
    const project = await prisma.project.create({ data: { name: "Route Test" } });
    await prisma.scheduleImport.create({ data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h" } });
    const draft = await getOrCreateDraft(project.id, "2026-06-18", 3);
    const req = new Request("http://localhost/api/updates/x/entries", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ activityExternalUid: 9, canonicalActivityKey: "9|x", status: "in_progress", actualStart: null, actualFinish: null, percentComplete: 25, note: null }] }),
    });
    const res = await POST(req, { params: { updateId: draft.id } });
    expect(res.status).toBe(200);
    const saved = await prisma.progressEntry.findMany({ where: { progressUpdateId: draft.id } });
    expect(saved.length).toBe(1);
    expect(saved[0].percentComplete).toBe(25);
    await prisma.project.delete({ where: { id: project.id } });
  }, 15000);
});
