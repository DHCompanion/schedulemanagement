import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { confirmDiscipline, getTradeDictionary, getKnownDisciplines, assignTradePartner, getProjectAssignments, getTradePartners } from "@/lib/trades/tradesService";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("tradesService", () => {
  let projectId = "";
  const scopes: string[] = [];
  const partners: string[] = [];
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    if (scopes.length) await prisma.tradeDictionaryEntry.deleteMany({ where: { canonicalScope: { in: scopes } } });
    if (partners.length) await prisma.tradePartner.deleteMany({ where: { name: { in: partners } } });
    await prisma.$disconnect();
  });

  it("learns disciplines globally and assigns partners per project", async () => {
    const project = await prisma.project.create({ data: { name: "Trades Test" } });
    projectId = project.id;
    const scope = `ZZ Scope ${Date.now()}`;
    const company = `ZZ Co ${Date.now()}`;
    scopes.push(scope);
    partners.push(company);

    await confirmDiscipline(scope, "Electrical");
    expect((await getTradeDictionary()).get(scope)).toBe("Electrical");
    expect(await getKnownDisciplines()).toContain("Electrical");

    await confirmDiscipline(scope, "Electrical-Low-Voltage");
    const e = await prisma.tradeDictionaryEntry.findUnique({ where: { canonicalScope: scope } });
    expect(e?.tradeDiscipline).toBe("Electrical-Low-Voltage");
    expect(e?.timesConfirmed).toBe(2);

    await assignTradePartner(project.id, "Electrical-Low-Voltage", company);
    expect((await getProjectAssignments(project.id)).get("Electrical-Low-Voltage")).toBe(company);
    expect(await getTradePartners()).toContain(company);
    await assignTradePartner(project.id, "Electrical-Low-Voltage", company);
    expect(await prisma.tradePartner.count({ where: { name: company } })).toBe(1);
  }, 30000);

  it("route persists disciplines and assignments", async () => {
    const { POST } = await import("@/app/api/trades/route");
    const project = await prisma.project.create({ data: { name: "Trades Route Test" } });
    const scope = `ZZ RouteScope ${Date.now()}`;
    const company = `ZZ RouteCo ${Date.now()}`;
    scopes.push(scope);
    partners.push(company);
    const req = new Request("http://localhost/api/trades", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, disciplines: [{ canonicalScope: scope, discipline: "Plumbing" }], assignments: [{ discipline: "Plumbing", companyName: company }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect((await getTradeDictionary()).get(scope)).toBe("Plumbing");
    expect((await getProjectAssignments(project.id)).get("Plumbing")).toBe(company);
    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);
});
