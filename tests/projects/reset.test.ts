import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { commitImport } from "@/lib/import/commitImport";
import { ADMIN_SESSION_COOKIE } from "@/lib/auth";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");
const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("project reset", () => {
  const created: string[] = [];

  beforeEach(() => {
    process.env.APP_SESSION_TOKEN = "token-abc";
  });

  afterAll(async () => {
    for (const id of created) await prisma.project.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });

  async function makeProjectWithImport(name: string): Promise<string> {
    const project = await prisma.project.create({ data: { name, onboardingCompletedAt: new Date() } });
    created.push(project.id);
    await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });
    return project.id;
  }

  function request(projectId: string, cookie?: string): Request {
    return new Request(`http://localhost/api/projects/${projectId}/reset`, {
      method: "POST",
      headers: cookie ? { Cookie: cookie } : {},
    });
  }

  it("refuses a non-admin session and leaves the schedule intact", async () => {
    const projectId = await makeProjectWithImport("Reset Test Denied");
    const { POST } = await import("@/app/api/projects/[id]/reset/route");

    const res = await POST(request(projectId), { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(403);
    expect(await prisma.scheduleImport.count({ where: { projectId } })).toBe(1);
  }, 30000);

  it("wipes the schedule data and re-arms the wizard for an admin", async () => {
    const projectId = await makeProjectWithImport("Reset Test Allowed");
    await prisma.completenessDismissal.create({
      data: { projectId, canonicalActivityKey: "1|mobilize", coarseScope: "Mobilize" },
    });
    const activitiesBefore = await prisma.activity.count({ where: { scheduleImport: { projectId } } });
    expect(activitiesBefore).toBeGreaterThan(0);

    const { POST } = await import("@/app/api/projects/[id]/reset/route");
    const res = await POST(request(projectId, `${ADMIN_SESSION_COOKIE}=token-abc`), { params: Promise.resolve({ id: projectId }) });
    expect(res.status).toBe(303);

    expect(await prisma.scheduleImport.count({ where: { projectId } })).toBe(0);
    expect(await prisma.activity.count({ where: { scheduleImport: { projectId } } })).toBe(0);
    expect(await prisma.completenessDismissal.count({ where: { projectId } })).toBe(0);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    expect(project).not.toBeNull();
    expect(project?.onboardingCompletedAt).toBeNull();
  }, 30000);
});
