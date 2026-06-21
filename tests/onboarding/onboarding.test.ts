import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");
const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("onboarding", () => {
  let projectId = "";
  let projectId2 = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    if (projectId2) await prisma.project.delete({ where: { id: projectId2 } });
    await prisma.$disconnect();
  });

  it("flags startWizard true on a brand-new project's first import", async () => {
    const project = await prisma.project.create({ data: { name: "Onboarding Test", onboardingCompletedAt: null } });
    projectId = project.id;

    const { POST } = await import("@/app/api/imports/commit/route");
    const fd = new FormData();
    fd.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
    fd.append("projectId", project.id);
    const res = await POST(new Request("http://localhost/api/imports/commit", { method: "POST", body: fd }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.startWizard).toBe(true);
  }, 30000);

  it("flags startWizard false once onboarding is already complete", async () => {
    const project = await prisma.project.create({ data: { name: "Onboarding Test 2", onboardingCompletedAt: new Date() } });
    projectId2 = project.id;

    const { POST } = await import("@/app/api/imports/commit/route");
    const fd = new FormData();
    fd.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
    fd.append("projectId", project.id);
    const res = await POST(new Request("http://localhost/api/imports/commit", { method: "POST", body: fd }));
    const data = await res.json();
    expect(data.startWizard).toBe(false);
  }, 30000);

  it("complete-onboarding route sets onboardingCompletedAt and redirects to the project page", async () => {
    const project = await prisma.project.create({ data: { name: "Onboarding Test 3", onboardingCompletedAt: null } });
    const { POST } = await import("@/app/api/projects/[id]/complete-onboarding/route");
    const res = await POST(new Request(`http://localhost/api/projects/${project.id}/complete-onboarding`, { method: "POST" }), { params: { id: project.id } });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain(`/projects/${project.id}`);
    const updated = await prisma.project.findUnique({ where: { id: project.id } });
    expect(updated?.onboardingCompletedAt).not.toBeNull();
    await prisma.project.delete({ where: { id: project.id } });
  }, 15000);
});
