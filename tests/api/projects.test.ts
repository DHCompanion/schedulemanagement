import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("projects route", () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) await prisma.project.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });

  function post(fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return new Request("http://localhost/api/projects", { method: "POST", body: form });
  }

  it("creates a project and redirects to it", async () => {
    const { POST } = await import("@/app/api/projects/route");
    const name = `ZZ Route Project ${Date.now()}`;
    const res = await POST(post({ name, client: "BSW" }));
    expect(res.status).toBe(303);

    const project = await prisma.project.findFirstOrThrow({ where: { name } });
    created.push(project.id);
    expect(res.headers.get("location")).toContain(project.id);
    expect(project.client).toBe("BSW");
  }, 30000);

  it("redirects with an error and creates nothing when the name is blank", async () => {
    const { POST } = await import("@/app/api/projects/route");
    const before = await prisma.project.count();
    const res = await POST(post({ name: "   " }));
    expect(res.headers.get("location")).toContain("error=1");
    expect(await prisma.project.count()).toBe(before);
  }, 30000);

  it("turns blank optional fields into null rather than empty strings", async () => {
    const { POST } = await import("@/app/api/projects/route");
    const name = `ZZ Route Blanks ${Date.now()}`;
    await POST(post({ name, client: "", sector: "" }));
    const project = await prisma.project.findFirstOrThrow({ where: { name } });
    created.push(project.id);
    expect(project.client).toBeNull();
    expect(project.sector).toBeNull();
  }, 30000);

  it("lists every project for an unscoped session", async () => {
    const { GET } = await import("@/app/api/projects/route");
    const res = await GET(new Request("http://localhost/api/projects"));
    expect(Array.isArray(await res.json())).toBe(true);
  }, 30000);
});
