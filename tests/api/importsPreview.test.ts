import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { SCOPE_COOKIE, signScope } from "@/lib/scope";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");
const hasDb = !!process.env.DATABASE_URL;

function post(body: FormData) {
  return new Request("http://localhost/api/imports/preview", { method: "POST", body });
}

describe("imports preview route", () => {
  afterAll(async () => { if (hasDb) await prisma.$disconnect(); });

  it("rejects a form with no file", async () => {
    const { POST } = await import("@/app/api/imports/preview/route");
    const res = await POST(post(new FormData()));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("No file uploaded.");
  });

  it("reports the title, counts and field definitions", async () => {
    const form = new FormData();
    form.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
    const { POST } = await import("@/app/api/imports/preview/route");
    const res = await POST(post(form));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.title).toBe("Minimal Test Schedule");
    expect(data.counts.activities).toBeGreaterThan(0);
    // The fixture declares Text1 aliased "Phoenix ID".
    expect(data.fieldDefinitions.map((f: { alias: string }) => f.alias)).toContain("Phoenix ID");
  });

  it("rejects unparseable input with 422", async () => {
    const form = new FormData();
    form.append("file", new File(["not xml at all"], "bad.xml", { type: "application/xml" }));
    const { POST } = await import("@/app/api/imports/preview/route");
    expect((await POST(post(form))).status).toBe(422);
  });

  it("refuses a project outside the session's scope", async () => {
    process.env.SESSION_SIGNING_SECRET = "signing-secret-abc".padEnd(32, "x");
    const cookie = await signScope({ projectId: "proj-a", osProjectId: 1, personId: 1 }, Math.floor(Date.now() / 1000));
    const form = new FormData();
    form.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
    form.append("projectId", "proj-b");
    const { POST } = await import("@/app/api/imports/preview/route");
    const res = await POST(new Request("http://localhost/api/imports/preview", { method: "POST", body: form, headers: { Cookie: `${SCOPE_COOKIE}=${cookie}` } }));
    expect(res.status).toBe(403);
  });

  it("has no re-import block without a projectId", async () => {
    const form = new FormData();
    form.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
    const { POST } = await import("@/app/api/imports/preview/route");
    expect((await (await POST(post(form))).json()).reimport).toBeUndefined();
  });

  it.runIf(hasDb)("compares against the project's last import, or says null on a first import", async () => {
    const project = await prisma.project.create({ data: { name: "ZZ Reimport Preview" } });
    try {
      const form = () => {
        const f = new FormData();
        f.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
        f.append("projectId", project.id);
        return f;
      };
      const { POST } = await import("@/app/api/imports/preview/route");
      expect((await (await POST(post(form()))).json()).reimport).toBeNull();

      await prisma.scheduleImport.create({ data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "old.xml", fileHash: "h" } });
      const { reimport } = await (await POST(post(form()))).json();
      expect(reimport).toEqual({ resplit: [], newNames: expect.any(Array), orphanedProgress: [] });
    } finally {
      await prisma.project.delete({ where: { id: project.id } });
    }
  }, 30000);

  it.runIf(hasDb)("writes nothing", async () => {
    // Asserted against a filename only this test uses, not a global row count.
    // Vitest runs test files in parallel against one shared database, and the
    // other suites create and delete imports as they go — a global count races
    // with them and fails in either direction.
    const probe = `zz-preview-probe-${Date.now()}.xml`;
    const form = new FormData();
    form.append("file", new File([xml], probe, { type: "application/xml" }));
    const { POST } = await import("@/app/api/imports/preview/route");
    await POST(post(form));
    expect(await prisma.scheduleImport.count({ where: { fileName: probe } })).toBe(0);
  }, 30000);
});
