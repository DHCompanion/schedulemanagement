import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { acceptSplit, resolveExportBase } from "@/lib/completeness/acceptSplit";
import { getCompleteness } from "@/lib/completeness/completenessService";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("acceptSplit", () => {
  let projectId = "";
  let firstImportId = "";
  let newImportId = "";
  const coarse = `ZZ Accept Coarse ${Date.now()}`;

  afterAll(async () => {
    await prisma.scopeSplitRule.deleteMany({ where: { coarseScope: coarse } });
    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: coarse.toLowerCase() } });
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("clones the latest import minus the coarse activity plus its splits, fans relationships, and records a CompletenessSplit", async () => {
    await prisma.scopeSplitRule.createMany({
      data: [
        { coarseScope: coarse, finerScope: "Finer A" },
        { coarseScope: coarse, finerScope: "Finer B" },
      ],
    });
    await prisma.scopeDictionaryEntry.upsert({
      where: { normalizedName: coarse.toLowerCase() },
      create: { normalizedName: coarse.toLowerCase(), canonicalScope: coarse },
      update: { canonicalScope: coarse },
    });

    const project = await prisma.project.create({ data: { name: "Accept Split Test" } });
    projectId = project.id;
    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h1" },
    });
    firstImportId = imp.id;
    const coarseKey = `2|${coarse.toLowerCase()}`;
    await prisma.activity.createMany({
      data: [
        { scheduleImportId: imp.id, externalUid: 1, wbsCode: "1", name: "Predecessor", canonicalActivityKey: "1|predecessor", type: "task" },
        {
          scheduleImportId: imp.id, externalUid: 2, wbsCode: "2", name: coarse, canonicalActivityKey: coarseKey, type: "task",
          durationMinutes: 2400, plannedStart: new Date("2026-03-02"), plannedFinish: new Date("2026-03-09"),
        },
        { scheduleImportId: imp.id, externalUid: 3, wbsCode: "3", name: "Successor", canonicalActivityKey: "3|successor", type: "task" },
      ],
    });
    await prisma.relationship.createMany({
      data: [
        { scheduleImportId: imp.id, predecessorExternalUid: 1, successorExternalUid: 2, type: "FS" },
        { scheduleImportId: imp.id, predecessorExternalUid: 2, successorExternalUid: 3, type: "FS" },
      ],
    });

    const result = await acceptSplit(project.id, coarse);
    newImportId = result.newImportId;

    const newImport = await prisma.scheduleImport.findUnique({
      where: { id: newImportId },
      include: { activities: true, relationships: true },
    });
    expect(newImport?.isSynthetic).toBe(true);
    expect(newImport?.derivedFromImportId).toBe(imp.id);

    const names = newImport!.activities.map((a) => a.name).sort();
    expect(names).toEqual(["Finer A", "Finer B", "Predecessor", "Successor"]);

    const finerA = newImport!.activities.find((a) => a.name === "Finer A")!;
    const finerB = newImport!.activities.find((a) => a.name === "Finer B")!;
    expect(finerA.wbsCode).toBe("2.1");
    expect(finerB.wbsCode).toBe("2.2");
    expect(finerA.durationMinutes).toBe(2400);
    expect(finerA.plannedStart?.toISOString()).toBe(new Date("2026-03-02").toISOString());
    expect(finerA.externalUid).not.toBe(finerB.externalUid);

    const rels = newImport!.relationships;
    expect(rels.some((r) => r.predecessorExternalUid === 1 && r.successorExternalUid === finerA.externalUid)).toBe(true);
    expect(rels.some((r) => r.predecessorExternalUid === 1 && r.successorExternalUid === finerB.externalUid)).toBe(true);
    expect(rels.some((r) => r.predecessorExternalUid === finerA.externalUid && r.successorExternalUid === 3)).toBe(true);
    expect(rels.some((r) => r.predecessorExternalUid === finerB.externalUid && r.successorExternalUid === 3)).toBe(true);
    expect(rels.some((r) => r.predecessorExternalUid === 2 || r.successorExternalUid === 2)).toBe(false);

    const split = await prisma.completenessSplit.findFirst({ where: { resultScheduleImportId: newImportId } });
    expect(split?.sourceScheduleImportId).toBe(imp.id);
    expect(split?.coarseExternalUid).toBe(2);
    expect(split?.coarseName).toBe(coarse);
    expect(split?.finerScopes).toEqual(["Finer A", "Finer B"]);

    const completeness = await getCompleteness(project.id);
    expect(completeness.issues).toHaveLength(0);
  }, 30000);

  it("resolveExportBase walks back through the synthetic import to the real ancestor", async () => {
    const { baseImport, splits } = await resolveExportBase(newImportId);
    expect(baseImport.id).toBe(firstImportId);
    expect(baseImport.isSynthetic).toBe(false);
    expect(splits).toHaveLength(1);
    expect(splits[0].coarseName).toBe(coarse);
  }, 15000);

  it("route accepts and returns the new import id", async () => {
    await prisma.scopeSplitRule.upsert({
      where: { coarseScope_finerScope: { coarseScope: coarse, finerScope: "Finer A" } },
      create: { coarseScope: coarse, finerScope: "Finer A" },
      update: {},
    });
    await prisma.scopeDictionaryEntry.upsert({
      where: { normalizedName: coarse.toLowerCase() },
      create: { normalizedName: coarse.toLowerCase(), canonicalScope: coarse },
      update: { canonicalScope: coarse },
    });
    const project = await prisma.project.create({ data: { name: "Accept Route Test" } });
    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h2" },
    });
    const key = `1|${coarse.toLowerCase()}`;
    await prisma.activity.create({
      data: { scheduleImportId: imp.id, externalUid: 1, wbsCode: "1", name: coarse, canonicalActivityKey: key, type: "task" },
    });

    const { POST } = await import("@/app/api/completeness/accept/route");
    const res = await POST(new Request("http://localhost/api/completeness/accept", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, coarseScope: coarse }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.newImportId).toBeTruthy();
    expect(data.splitCount).toBeGreaterThan(0);

    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);

  it("route rejects a missing projectId", async () => {
    const { POST } = await import("@/app/api/completeness/accept/route");
    const res = await POST(new Request("http://localhost/api/completeness/accept", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canonicalActivityKey: "x", coarseScope: "y" }),
    }));
    expect(res.status).toBe(422);
  });

  it("collects every split recorded against one synthetic import", async () => {
    const project = await prisma.project.create({ data: { name: "Multi Split Base" } });
    const base = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "b.xml", fileHash: `h-${project.id}` },
    });
    const synthetic = await prisma.scheduleImport.create({
      data: {
        projectId: project.id, sourceFormat: "msproject_xml", fileName: "b.xml", fileHash: `h-${project.id}`,
        isSynthetic: true, derivedFromImportId: base.id,
      },
    });
    for (const [i, name] of ["Coarse A", "Coarse B"].entries()) {
      await prisma.completenessSplit.create({
        data: {
          projectId: project.id, sourceScheduleImportId: base.id, resultScheduleImportId: synthetic.id,
          coarseExternalUid: 100 + i, coarseName: name, finerScopes: ["X", "Y"], mintedUids: [200 + i * 2, 201 + i * 2],
        },
      });
    }

    const { baseImport, splits } = await resolveExportBase(synthetic.id);
    expect(baseImport.id).toBe(base.id);
    expect(splits).toHaveLength(2);
    expect(splits.map((s) => s.coarseName).sort()).toEqual(["Coarse A", "Coarse B"]);

    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);

  it("splits every flagged instance in one import and leaves dismissed ones alone", async () => {
    const coarse = `ZZ Batch ${Date.now()}`;
    await prisma.scopeSplitRule.createMany({
      data: [{ coarseScope: coarse, finerScope: "Part A" }, { coarseScope: coarse, finerScope: "Part B" }],
    });
    const project = await prisma.project.create({ data: { name: "Batch Split Test" } });
    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "b.xml", fileHash: `h-${project.id}` },
    });
    for (let i = 1; i <= 3; i += 1) {
      await prisma.activity.create({
        data: {
          scheduleImportId: imp.id, externalUid: i, externalId: i, wbsCode: `1.${i}`,
          name: coarse, canonicalActivityKey: `1.${i}|${coarse.toLowerCase()}`, type: "task",
        },
      });
    }
    await prisma.completenessDismissal.create({
      data: { projectId: project.id, canonicalActivityKey: `1.3|${coarse.toLowerCase()}`, coarseScope: coarse },
    });

    const { newImportId, splitCount } = await acceptSplit(project.id, coarse);
    expect(splitCount).toBe(2);

    const splits = await prisma.completenessSplit.findMany({ where: { resultScheduleImportId: newImportId } });
    expect(splits).toHaveLength(2);

    const result = await prisma.activity.findMany({ where: { scheduleImportId: newImportId } });
    expect(result.filter((a) => a.name === "Part A")).toHaveLength(2);
    expect(result.filter((a) => a.name === "Part B")).toHaveLength(2);
    // The dismissed instance survives untouched.
    expect(result.filter((a) => a.name === coarse)).toHaveLength(1);
    // Minted UIDs never collide.
    expect(new Set(result.map((a) => a.externalUid)).size).toBe(result.length);

    await prisma.scopeSplitRule.deleteMany({ where: { coarseScope: coarse } });
    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);

  it("fans a relationship between two coarse activities in the same batch to the cross-product of both minted UID sets", async () => {
    const coarse = `ZZ Cross ${Date.now()}`;
    await prisma.scopeSplitRule.createMany({
      data: [{ coarseScope: coarse, finerScope: "Part A" }, { coarseScope: coarse, finerScope: "Part B" }],
    });
    const project = await prisma.project.create({ data: { name: "Cross Product Split Test" } });
    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "c.xml", fileHash: `h-${project.id}` },
    });
    await prisma.activity.createMany({
      data: [
        { scheduleImportId: imp.id, externalUid: 1, externalId: 1, wbsCode: "1", name: coarse, canonicalActivityKey: `1|${coarse.toLowerCase()}`, type: "task" },
        { scheduleImportId: imp.id, externalUid: 2, externalId: 2, wbsCode: "2", name: coarse, canonicalActivityKey: `2|${coarse.toLowerCase()}`, type: "task" },
      ],
    });
    // Both ends of this relationship are coarse activities in the same batch.
    await prisma.relationship.create({
      data: { scheduleImportId: imp.id, predecessorExternalUid: 1, successorExternalUid: 2, type: "FS" },
    });

    const { newImportId } = await acceptSplit(project.id, coarse);

    const newImport = await prisma.scheduleImport.findUniqueOrThrow({
      where: { id: newImportId },
      include: { relationships: true },
    });

    // Neither original coarse externalUid survives in any relationship.
    expect(newImport.relationships.some((r) => r.predecessorExternalUid === 1 || r.successorExternalUid === 1)).toBe(false);
    expect(newImport.relationships.some((r) => r.predecessorExternalUid === 2 || r.successorExternalUid === 2)).toBe(false);
    // 2 finer scopes on each side of the one relationship = the full cross-product.
    expect(newImport.relationships).toHaveLength(4);
    expect(newImport.relationshipCount).toBe(newImport.relationships.length);

    await prisma.scopeSplitRule.deleteMany({ where: { coarseScope: coarse } });
    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);
});
