import { describe, it, expect, afterAll } from "vitest";
import { POST as dismissTrade } from "@/app/api/trades/dismiss/route";
import { POST as dismissCompleteness } from "@/app/api/completeness/dismiss/route";
import { prisma } from "@/lib/db";
import { SCOPE_COOKIE, signScope } from "@/lib/scope";

const hasDb = !!process.env.DATABASE_URL;
const PERSON_ID = 4242;

process.env.SESSION_SIGNING_SECRET ||= "linkage-test-secret".padEnd(32, "x");

async function scopedRequest(projectId: string, body: unknown): Promise<Request> {
  const scope = await signScope(
    { projectId, osProjectId: 555111, personId: PERSON_ID, toolLevel: "user" },
    Math.floor(Date.now() / 1000)
  );
  return new Request("https://tool.test/api", {
    method: "POST",
    headers: { Cookie: `${SCOPE_COOKIE}=${scope}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Who did what cannot be reconstructed later, so it is captured at write time
// from the signed scope — never from the request body.
describe.runIf(hasDb)("OS person linkage", () => {
  let projectId: string;

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { name: "Linkage Test" } });
    await prisma.$disconnect();
  });

  it("stamps the scoped person on a trade scope dismissal", async () => {
    const project = await prisma.project.create({ data: { name: "Linkage Test" } });
    projectId = project.id;

    const res = await dismissTrade(await scopedRequest(projectId, { projectId, canonicalScope: "drywall" }));
    expect(res.status).toBe(200);

    const row = await prisma.tradeScopeDismissal.findFirst({ where: { projectId } });
    expect(row?.personId).toBe(PERSON_ID);
  });

  it("stamps the scoped person on a completeness dismissal", async () => {
    const res = await dismissCompleteness(
      await scopedRequest(projectId, {
        projectId,
        canonicalActivityKey: "key-1",
        coarseScope: "coarse-1",
        note: "not a real gap",
      })
    );
    expect(res.status).toBe(200);

    const row = await prisma.completenessDismissal.findFirst({ where: { projectId } });
    expect(row?.personId).toBe(PERSON_ID);
  });

  it("leaves personId null for an unscoped standalone write", async () => {
    const project = await prisma.project.create({ data: { name: "Linkage Test" } });
    const res = await dismissTrade(
      new Request("https://tool.test/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, canonicalScope: "electrical" }),
      })
    );
    expect(res.status).toBe(200);

    const row = await prisma.tradeScopeDismissal.findFirst({ where: { projectId: project.id } });
    expect(row?.personId).toBeNull();
  });
});
