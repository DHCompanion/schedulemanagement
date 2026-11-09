import { describe, it, expect, afterAll, vi } from "vitest";

const emitted = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/spine", () => ({ emitUpdateEvent: async (e: unknown) => { emitted.push(e); } }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => fn() }));
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { commitImport } from "@/lib/import/commitImport";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");
const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("updates routes", () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) await prisma.project.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });

  async function projectWithImport() {
    const project = await prisma.project.create({ data: { name: `ZZ Updates Route ${Date.now()}` } });
    created.push(project.id);
    await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });
    return project.id;
  }

  function post(fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return new Request("http://localhost/api/updates", { method: "POST", body: form });
  }

  it("creates a draft and redirects to it", async () => {
    const projectId = await projectWithImport();
    const { POST } = await import("@/app/api/updates/route");
    const res = await POST(post({ projectId, asOfDate: "2026-06-18", lookaheadWeeks: "3" }));
    expect(res.status).toBe(303);

    const draft = await prisma.progressUpdate.findFirstOrThrow({ where: { projectId } });
    expect(draft.state).toBe("draft");
    expect(draft.lookaheadWeeks).toBe(3);
    expect(res.headers.get("location")).toContain(draft.id);
  }, 30000);

  it("falls back to a 3-week lookahead for an unsupported value", async () => {
    const projectId = await projectWithImport();
    const { POST } = await import("@/app/api/updates/route");
    await POST(post({ projectId, asOfDate: "2026-06-18", lookaheadWeeks: "5" }));
    const draft = await prisma.progressUpdate.findFirstOrThrow({ where: { projectId } });
    expect(draft.lookaheadWeeks).toBe(3);
  }, 30000);

  it("redirects home when projectId is missing", async () => {
    const { POST } = await import("@/app/api/updates/route");
    const res = await POST(post({ asOfDate: "2026-06-18" }));
    expect(res.status).toBe(303);
    expect(await prisma.progressUpdate.count({ where: { projectId: "" } })).toBe(0);
  }, 30000);

  it("finalize returns 404 for an unknown update", async () => {
    const { POST } = await import("@/app/api/updates/[updateId]/finalize/route");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ updateId: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("Update not found.");
  }, 30000);

  it("finalize marks the update finalized", async () => {
    const projectId = await projectWithImport();
    const { POST: createDraft } = await import("@/app/api/updates/route");
    await createDraft(post({ projectId, asOfDate: "2026-06-18", lookaheadWeeks: "3" }));
    const draft = await prisma.progressUpdate.findFirstOrThrow({ where: { projectId } });

    const { POST } = await import("@/app/api/updates/[updateId]/finalize/route");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ updateId: draft.id }),
    });
    expect(res.status).toBe(200);
    const after = await prisma.progressUpdate.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.state).toBe("finalized");
    expect(after.finalizedAt).not.toBeNull();
  }, 30000);

  const json = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const params = (updateId: string) => ({ params: Promise.resolve({ updateId }) });

  it("changes a draft's data date, or answers 422 with the reason", async () => {
    const projectId = await projectWithImport();
    const { POST: createDraft } = await import("@/app/api/updates/route");
    await createDraft(post({ projectId, asOfDate: "2026-06-18", lookaheadWeeks: "3" }));
    const draft = await prisma.progressUpdate.findFirstOrThrow({ where: { projectId } });
    const { POST } = await import("@/app/api/updates/[updateId]/date/route");
    expect((await POST(json({ asOfDate: "2026-06-25" }), params(draft.id))).status).toBe(200);
    expect((await prisma.progressUpdate.findUniqueOrThrow({ where: { id: draft.id } })).asOfDate.toISOString().slice(0, 10)).toBe("2026-06-25");
    const bad = await POST(json({ asOfDate: "nope" }), params(draft.id));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.message).toBe("Enter a real date.");
    expect((await POST(json({ asOfDate: "2026-06-25" }), params("does-not-exist"))).status).toBe(404);
  }, 30000);

  it("discards a draft but not a finalized update, and refuses a new draft on or before the last finalized date", async () => {
    const projectId = await projectWithImport();
    const { POST: createDraft } = await import("@/app/api/updates/route");
    const { POST: finalize } = await import("@/app/api/updates/[updateId]/finalize/route");
    const { POST: discard } = await import("@/app/api/updates/[updateId]/discard/route");
    await createDraft(post({ projectId, asOfDate: "2026-06-18", lookaheadWeeks: "3" }));
    const first = await prisma.progressUpdate.findFirstOrThrow({ where: { projectId } });
    emitted.length = 0;
    await finalize(new Request("http://localhost/x", { method: "POST" }), params(first.id));
    expect((await discard(new Request("http://localhost/x", { method: "POST" }), params(first.id))).status).toBe(409);
    expect(emitted).toEqual([{ osProjectId: null, eventType: "schedule-manager.update.finalized", updateId: first.id, summary: "Schedule update for 2026-06-18 finalized" }]);

    const refused = await createDraft(post({ projectId, asOfDate: "2026-06-18", lookaheadWeeks: "3" }));
    expect(decodeURIComponent(refused.headers.get("location")!)).toContain("after the last finalized update (2026-06-18)");
    await createDraft(post({ projectId, asOfDate: "2026-06-25", lookaheadWeeks: "3" }));
    const second = await prisma.progressUpdate.findFirstOrThrow({ where: { projectId, state: "draft" } });
    expect((await discard(new Request("http://localhost/x", { method: "POST" }), params(second.id))).status).toBe(200);
    expect(emitted[1]).toEqual({ osProjectId: null, eventType: "schedule-manager.update.discarded", updateId: second.id, summary: "Draft schedule update for 2026-06-25 discarded" });
    expect(await prisma.progressUpdate.count({ where: { projectId } })).toBe(1);
  }, 30000);
});
