import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";

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

  it.runIf(hasDb)("writes nothing", async () => {
    const before = await prisma.scheduleImport.count();
    const form = new FormData();
    form.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
    const { POST } = await import("@/app/api/imports/preview/route");
    await POST(post(form));
    expect(await prisma.scheduleImport.count()).toBe(before);
  }, 30000);
});
