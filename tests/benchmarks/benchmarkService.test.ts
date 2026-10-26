import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";
import { signSession } from "@/lib/scope";
import { getBenchmarkRanges, getBenchmarkStatus, getProjectBenchmarks, recomputeBenchmarks } from "@/lib/benchmarks/benchmarkService";

describe.runIf(!!process.env.DATABASE_URL)("benchmarkService (db)", () => {
  const tag = `zb${Date.now()}`;
  const scope = `Paint ${tag}`;
  afterAll(async () => {
    await prisma.project.deleteMany({ where: { name: { contains: tag } } });
    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: { contains: tag } } });
    await prisma.scopeBenchmark.deleteMany({ where: { canonicalScope: scope } });
    await prisma.$disconnect();
  });

  // One Paint activity per import: Mon 3 Mar 2025 plus `days` working days, actually finished.
  async function project(name: string, imports: { days: number; tierOverride?: string; isSynthetic?: boolean }[], sector: string | null = "Healthcare", buildingType: string | null = "Clinic") {
    const p = await prisma.project.create({ data: { name: `${name} ${tag}`, sector, buildingType, status: "historical" } });
    for (const [i, imp] of imports.entries()) {
      const finish = new Date(Date.UTC(2025, 2, 3 + imp.days - 1 + 2 * Math.floor((imp.days - 1) / 5)));
      await prisma.scheduleImport.create({
        data: {
          projectId: p.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: `${tag}-${name}-${i}`,
          importedAt: new Date(Date.UTC(2025, 0, 1 + i)), tierOverride: imp.tierOverride ?? "as_built", isSynthetic: imp.isSynthetic ?? false,
          activities: { create: [{
            externalUid: 1, name: `paint ${tag}`, canonicalActivityKey: `k${i}`, type: "task",
            plannedStart: new Date(Date.UTC(2025, 2, 3)), plannedFinish: finish, actualStart: new Date(Date.UTC(2025, 2, 3)), actualFinish: finish,
          }] },
        },
      });
    }
    return p.id;
  }

  it("rebuilds from eligible imports only, one contribution per project, and blends by building type", async () => {
    await prisma.scopeDictionaryEntry.create({ data: { normalizedName: `paint ${tag}`, canonicalScope: scope } });
    // Planned comes from the earliest eligible import, actual from the latest; rough and synthetic ones are skipped.
    const first = await project("A", [{ days: 50, tierOverride: "rough" }, { days: 2 }, { days: 4 }, { days: 90, isSynthetic: true }]);
    for (const [i, days] of [4, 6, 8, 10].entries()) await project(`B${i}`, [{ days }], "Healthcare", i < 2 ? "Clinic" : "OR Suite");
    await project("NoSector", [{ days: 99 }], null, null);

    expect((await recomputeBenchmarks()).rows).toBeGreaterThan(0);
    expect((await getBenchmarkStatus()).computedAt).not.toBeNull();
    const rows = await prisma.scopeBenchmark.findMany({ where: { canonicalScope: scope }, orderBy: [{ measure: "asc" }, { groupKind: "asc" }, { groupValue: "asc" }] });
    // Actual: A contributes 4 (latest eligible), Clinic B0/B1 4 and 6, OR Suite 8 and 10. Planned: A contributes 2.
    expect(rows.map((r) => [r.measure, r.groupKind, r.groupValue, r.n, r.median])).toEqual([
      ["actual", "buildingType", "Clinic", 3, 4],
      ["actual", "buildingType", "OR Suite", 2, 9],
      ["actual", "sector", "Healthcare", 5, 6],
      ["planned", "buildingType", "Clinic", 3, 4],
      ["planned", "buildingType", "OR Suite", 2, 9],
      ["planned", "sector", "Healthcare", 5, 6],
    ]);

    // Clinic's 3 projects weigh 3/8 against the sector's median of 6.
    const ranges = await getBenchmarkRanges("Healthcare", "Clinic");
    expect(ranges.get(scope)?.actual).toMatchObject({ n: 5, typeN: 3, median: (3 * 4 + 5 * 6) / 8 });

    // Project A's latest schedule is the synthetic 90-day one: far beyond the fences.
    expect((await getProjectBenchmarks(first)).get(scope)).toMatchObject({ projectDays: 90, outside: true });
  }, 60000);

  it("route recomputes for an admin and refuses everyone else", async () => {
    process.env.SESSION_SIGNING_SECRET = process.env.SESSION_SIGNING_SECRET || "token-abc".padEnd(32, "x");
    const { POST } = await import("@/app/api/history/benchmarks/route");
    const url = "http://localhost/api/history/benchmarks";
    expect((await POST(new Request(url, { method: "POST" }))).status).toBe(403);
    const cookie = `${SESSION_COOKIE}=${await signSession(true, Math.floor(Date.now() / 1000))}`;
    const res = await POST(new Request(url, { method: "POST", headers: { Cookie: cookie } }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/history$/);
  }, 60000);
});
