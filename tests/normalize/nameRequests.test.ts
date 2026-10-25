import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { SCOPE_COOKIE, signScope } from "@/lib/scope";

describe.runIf(!!process.env.DATABASE_URL)("POST /api/normalize/requests", () => {
  const tag = `zr${Date.now()}`;
  const ids: string[] = [];
  beforeEach(() => {
    process.env.SESSION_SIGNING_SECRET = "r".repeat(32);
  });
  afterAll(async () => {
    await prisma.standardScopeRequest.deleteMany({ where: { normalizedName: { contains: tag } } });
    await prisma.project.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  async function post(projectId: string, rawName: string, scopedTo = projectId) {
    const { POST } = await import("@/app/api/normalize/requests/route");
    const cookie = `${SCOPE_COOKIE}=${await signScope({ projectId: scopedTo, osProjectId: 1, personId: 7, personName: "Pat PM", toolLevel: "user" }, Math.floor(Date.now() / 1000))}`;
    return POST(new Request("http://localhost/api/normalize/requests", {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ projectId, rawName }),
    }));
  }

  it("records who asked, and refuses other projects and historical ones", async () => {
    const live = await prisma.project.create({ data: { name: `Live ${tag}` } });
    const old = await prisma.project.create({ data: { name: `Old ${tag}`, status: "historical" } });
    ids.push(live.id, old.id);

    expect((await post(live.id, `Hydro Test ${tag}`)).status).toBe(200);
    expect(await prisma.standardScopeRequest.findUnique({ where: { normalizedName: `hydro test ${tag}` } }))
      .toMatchObject({ rawName: `Hydro Test ${tag}`, projectId: live.id, personId: 7, requestedBy: "Pat PM" });

    expect((await post(live.id, `Other ${tag}`, old.id)).status).toBe(403);
    expect((await post(old.id, `Other ${tag}`)).status).toBe(403);
    expect((await post(live.id, " ")).status).toBe(422);
  });
});
