import { describe, it, expect, afterAll } from "vitest";
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
});
