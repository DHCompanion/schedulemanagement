import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";

const hasDb = !!process.env.DATABASE_URL;
const coarse = `ZZ Reimport Coarse ${Date.now()}`;
// The fixture's Electrical Rough-In (WBS 2) stands in for a coarse activity.
const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8").replace("Electrical Rough-In", coarse);

function commit(projectId: string, reapply: boolean) {
  const form = new FormData();
  form.append("file", new File([xml], "reimport.xml", { type: "application/xml" }));
  form.append("projectId", projectId);
  if (reapply) form.append("reapplySplits", "1");
  return new Request("http://localhost/api/imports/commit", { method: "POST", body: form });
}

describe.runIf(hasDb)("commit with reapplySplits", () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    await prisma.scopeSplitRule.deleteMany({ where: { coarseScope: coarse } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.$disconnect();
  });

  async function projectThatSplitBefore() {
    const project = await prisma.project.create({ data: { name: "ZZ Reimport Commit" } });
    projectIds.push(project.id);
    const old = await prisma.scheduleImport.create({ data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "old.xml", fileHash: "h0" } });
    const synthetic = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "old.xml", fileHash: "h0", isSynthetic: true, derivedFromImportId: old.id },
    });
    await prisma.completenessSplit.create({
      data: {
        projectId: project.id, sourceScheduleImportId: old.id, resultScheduleImportId: synthetic.id,
        coarseExternalUid: 2, coarseName: coarse, finerScopes: ["Finer A", "Finer B"], mintedUids: [100, 101],
      },
    });
    return project.id;
  }

  it("re-splits the scopes this project split before, and only when asked", async () => {
    await prisma.scopeSplitRule.createMany({ data: [{ coarseScope: coarse, finerScope: "Finer A" }, { coarseScope: coarse, finerScope: "Finer B" }] });
    const { POST } = await import("@/app/api/imports/commit/route");

    const asked = await projectThatSplitBefore();
    const res = await POST(commit(asked, true));
    expect(res.status).toBe(200);
    expect((await res.json()).resplit).toEqual([coarse]);
    const latest = await prisma.scheduleImport.findFirstOrThrow({ where: { projectId: asked }, orderBy: { importedAt: "desc" }, include: { activities: true } });
    expect(latest.isSynthetic).toBe(true);
    expect(latest.activities.map((a) => a.name)).toEqual(expect.arrayContaining(["Finer A", "Finer B"]));
    expect(latest.activities.map((a) => a.name)).not.toContain(coarse);

    const notAsked = await projectThatSplitBefore();
    await POST(commit(notAsked, false));
    const newest = await prisma.scheduleImport.findFirstOrThrow({ where: { projectId: notAsked }, orderBy: { importedAt: "desc" } });
    expect(newest.isSynthetic).toBe(false);
  }, 60000);
});
