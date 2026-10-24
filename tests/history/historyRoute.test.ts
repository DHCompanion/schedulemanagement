import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";
import { SCOPE_COOKIE, signScope, signSession } from "@/lib/scope";

describe.runIf(!!process.env.DATABASE_URL)("POST /api/history/[id]", () => {
  const ids: string[] = [];
  const now = () => Math.floor(Date.now() / 1000);
  beforeEach(() => {
    process.env.SESSION_SIGNING_SECRET = "h".repeat(32);
  });
  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  async function historical(status = "historical") {
    const p = await prisma.project.create({ data: { name: "Hist", status } });
    ids.push(p.id);
    const imp = await prisma.scheduleImport.create({
      data: { projectId: p.id, sourceFormat: "msproject_xml", fileName: "a.xml", fileHash: "a" },
    });
    return { id: p.id, importId: imp.id };
  }

  async function post(id: string, fields: Record<string, string>, cookie?: string) {
    const { POST } = await import("@/app/api/history/[id]/route");
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    const req = new Request(`http://localhost/api/history/${id}`, { method: "POST", body, headers: cookie ? { Cookie: cookie } : {} });
    return POST(req, { params: Promise.resolve({ id }) });
  }
  const admin = async () => `${SESSION_COOKIE}=${await signSession(true, now())}`;

  it("refuses non-admins", async () => {
    const { id } = await historical();
    const user = `${SESSION_COOKIE}=${await signSession(false, now())}`;
    const scopedUser = `${SCOPE_COOKIE}=${await signScope({ projectId: "x", osProjectId: 1, personId: 1, toolLevel: "user" }, now())}`;
    for (const cookie of [undefined, user, scopedUser]) {
      expect((await post(id, { sector: "Healthcare" }, cookie)).status).toBe(403);
    }
  });

  it("saves details for a standalone or OS-launched admin", async () => {
    const { id } = await historical();
    const res = await post(id, { buildingType: "OR Suite", sizeSqFt: "4,200" }, await admin());
    expect(res.status).toBe(303);
    expect(await prisma.project.findUnique({ where: { id } })).toMatchObject({ sector: "Healthcare", buildingType: "OR Suite", sizeSqFt: 4200 });

    const osAdmin = `${SCOPE_COOKIE}=${await signScope({ projectId: "x", osProjectId: 1, personId: 1, toolLevel: "admin" }, now())}`;
    expect((await post(id, { sector: "", buildingType: "", sizeSqFt: "" }, osAdmin)).status).toBe(303);
    expect(await prisma.project.findUnique({ where: { id } })).toMatchObject({ sector: null, buildingType: null, sizeSqFt: null });
  });

  it("takes the sector from the project type", async () => {
    const { id } = await historical();
    expect((await post(id, { buildingType: "Schools" }, await admin())).status).toBe(303);
    expect(await prisma.project.findUnique({ where: { id } })).toMatchObject({ sector: "Institutional", buildingType: "Schools" });
    expect((await post(id, { sector: "Healthcare", buildingType: "Schools" }, await admin())).status).toBe(422);
  });

  it("rejects values outside the lists", async () => {
    const { id } = await historical();
    expect((await post(id, { sector: "Retail" }, await admin())).status).toBe(422);
    expect((await post(id, { buildingType: "Hospital" }, await admin())).status).toBe(422);
    expect((await post(id, { sizeSqFt: "-5" }, await admin())).status).toBe(422);
  });

  it("sets and clears an import's tier override, but not to as-built or baseline", async () => {
    const { id, importId } = await historical();
    expect((await post(id, { importId, tierOverride: "junk" }, await admin())).status).toBe(303);
    expect((await prisma.scheduleImport.findUnique({ where: { id: importId } }))?.tierOverride).toBe("junk");
    expect((await post(id, { importId, tierOverride: "" }, await admin())).status).toBe(303);
    expect((await prisma.scheduleImport.findUnique({ where: { id: importId } }))?.tierOverride).toBeNull();
    expect((await post(id, { importId, tierOverride: "as_built" }, await admin())).status).toBe(422);
  });

  it("only edits historical projects, and only their own imports", async () => {
    const live = await historical("active");
    expect((await post(live.id, { sector: "Healthcare" }, await admin())).status).toBe(404);
    const a = await historical();
    expect((await post(a.id, { importId: live.importId, tierOverride: "rough" }, await admin())).status).toBe(404);
  });
});
