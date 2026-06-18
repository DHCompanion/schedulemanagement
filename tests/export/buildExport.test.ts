import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { commitImport } from "@/lib/import/commitImport";
import { getOrCreateDraft, saveEntries, finalizeUpdate } from "@/lib/updates/updateService";
import { buildExport } from "@/lib/export/buildExport";
import { parseForExport } from "@/lib/export/serializeMspdi";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");
const hasDb = !!process.env.DATABASE_URL;

function findTask(doc: Record<string, unknown>, uid: string) {
  return (((doc.Project as any).Tasks.Task) as any[]).find((t) => String(t.UID) === uid);
}

describe.runIf(hasDb)("buildExport", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("injects cumulative progress and rejects bad inputs", async () => {
    const project = await prisma.project.create({ data: { name: "Export Test" } });
    projectId = project.id;
    await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });

    // no finalized progress yet -> throws
    await expect(buildExport(project.id, xml, "minimal.xml")).rejects.toThrow(/no finalized progress/i);

    // finalize an update marking UID 2 (canonicalKey "2|electrical rough-in") in progress
    const { id } = await getOrCreateDraft(project.id, "2026-06-18", 1);
    await saveEntries(id, [{ activityExternalUid: 2, canonicalActivityKey: "2|electrical rough-in", status: "in_progress", actualStart: "2026-06-16", actualFinish: null, percentComplete: 50, note: null }]);
    await finalizeUpdate(id);

    const out = await buildExport(project.id, xml, "minimal.xml");
    expect(out.fileName).toBe("minimal-updated-2026-06-18.xml");
    const doc = parseForExport(out.xml);
    expect(findTask(doc, "2").ActualStart).toBe("2026-06-16T00:00:00");
    expect(String(findTask(doc, "2").PercentComplete)).toBe("50");
    expect((doc.Project as any).StatusDate).toBe("2026-06-18T00:00:00");

    // hash mismatch -> throws
    await expect(buildExport(project.id, xml + "<!-- changed -->", "minimal.xml")).rejects.toThrow(/match/i);
  }, 30000);

  it("throws when the project has no import", async () => {
    const p = await prisma.project.create({ data: { name: "No Import Export" } });
    await expect(buildExport(p.id, xml, "minimal.xml")).rejects.toThrow(/no imported schedule/i);
    await prisma.project.delete({ where: { id: p.id } });
  });

  it("route returns the updated xml as an attachment", async () => {
    const { POST } = await import("@/app/api/export/route");
    const project = await prisma.project.create({ data: { name: "Export Route Test" } });
    await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });
    const { id } = await getOrCreateDraft(project.id, "2026-06-18", 1);
    await saveEntries(id, [{ activityExternalUid: 2, canonicalActivityKey: "2|electrical rough-in", status: "complete", actualStart: "2026-06-16", actualFinish: "2026-06-18", percentComplete: 100, note: null }]);
    await finalizeUpdate(id);

    const fd = new FormData();
    fd.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
    fd.append("projectId", project.id);
    const res = await POST(new Request("http://localhost/api/export", { method: "POST", body: fd }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/xml");
    expect(res.headers.get("Content-Disposition")).toContain("minimal-updated-2026-06-18.xml");
    const body = await res.text();
    expect(body).toContain("<ActualFinish>2026-06-18T00:00:00</ActualFinish>");

    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);
});
