import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  confirmDiscipline,
  getTradeDictionary,
  getProjectDisciplines,
  getPartnersForDiscipline,
  assignTradePartner,
  getProjectAssignments,
  dismissScope,
  restoreScope,
  getDismissedScopes,
} from "@/lib/trades/tradesService";

const ELECTRICAL = { id: 4101, name: "Electrical", division: "26" };
const LOW_VOLTAGE = { id: 4102, name: "Electrical - Low Voltage", division: "27" };

/** Stands in for the roster Connect caches at launch. */
async function seedRoster(projectId: string) {
  await prisma.osTradePartner.createMany({
    data: [
      { projectId, osPartnerId: 9001, name: "ZZ Sparks Electric", doNotUse: false, disciplines: [ELECTRICAL, LOW_VOLTAGE] },
      { projectId, osPartnerId: 9002, name: "ZZ Barred Electric", doNotUse: true, disciplines: [ELECTRICAL] },
    ],
  });
}

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("tradesService", () => {
  let projectId = "";
  const scopes: string[] = [];
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    if (scopes.length) await prisma.tradeDictionaryEntry.deleteMany({ where: { canonicalScope: { in: scopes } } });
    await prisma.$disconnect();
  });

  it("learns the scope mapping globally and assigns an OS partner per project", async () => {
    const project = await prisma.project.create({ data: { name: "Trades Test" } });
    projectId = project.id;
    await seedRoster(project.id);
    const scope = `ZZ Scope ${Date.now()}`;
    scopes.push(scope);

    // Disciplines are the OS ones attached to the project's partners; do-not-use
    // partners contribute neither disciplines nor candidates.
    expect(await getProjectDisciplines(project.id)).toEqual([ELECTRICAL, LOW_VOLTAGE]);

    await confirmDiscipline(scope, ELECTRICAL.id, ELECTRICAL.name);
    expect((await getTradeDictionary()).get(scope)).toMatchObject({ id: ELECTRICAL.id, name: ELECTRICAL.name });

    await confirmDiscipline(scope, LOW_VOLTAGE.id, LOW_VOLTAGE.name);
    const entry = await prisma.tradeDictionaryEntry.findUnique({ where: { canonicalScope: scope } });
    expect(entry?.osDisciplineId).toBe(LOW_VOLTAGE.id);
    expect(entry?.timesConfirmed).toBe(2);

    expect(await getPartnersForDiscipline(project.id, LOW_VOLTAGE.id)).toEqual([
      { osPartnerId: 9001, name: "ZZ Sparks Electric" },
    ]);

    await assignTradePartner(project.id, LOW_VOLTAGE.id, 9001, 77);
    const assigned = (await getProjectAssignments(project.id)).get(LOW_VOLTAGE.id);
    expect(assigned).toEqual({ osPartnerId: 9001, name: "ZZ Sparks Electric", onRoster: true });
    expect((await prisma.projectTradeAssignment.findFirst({ where: { projectId: project.id } }))?.personId).toBe(77);

    // Ids that are not on this project's roster are refused, as is a do-not-use
    // partner — the client supplies them and cannot be trusted.
    await assignTradePartner(project.id, ELECTRICAL.id, 9999);
    await assignTradePartner(project.id, ELECTRICAL.id, 9002);
    expect((await getProjectAssignments(project.id)).has(ELECTRICAL.id)).toBe(false);
  }, 30000);

  it("shows the live roster name and flags a partner that has left the project", async () => {
    const project = await prisma.project.create({ data: { name: "Trades Rename Test" } });
    await seedRoster(project.id);
    await assignTradePartner(project.id, ELECTRICAL.id, 9001);

    await prisma.osTradePartner.update({
      where: { projectId_osPartnerId: { projectId: project.id, osPartnerId: 9001 } },
      data: { name: "ZZ Sparks Electric LLC" },
    });
    expect((await getProjectAssignments(project.id)).get(ELECTRICAL.id)?.name).toBe("ZZ Sparks Electric LLC");

    await prisma.osTradePartner.deleteMany({ where: { projectId: project.id } });
    expect((await getProjectAssignments(project.id)).get(ELECTRICAL.id)).toEqual({
      osPartnerId: 9001,
      name: "ZZ Sparks Electric",
      onRoster: false,
    });

    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);

  it("route persists the mapping and the assignment", async () => {
    const { POST } = await import("@/app/api/trades/route");
    const project = await prisma.project.create({ data: { name: "Trades Route Test" } });
    await seedRoster(project.id);
    const scope = `ZZ RouteScope ${Date.now()}`;
    scopes.push(scope);

    const req = new Request("http://localhost/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        disciplines: [{ canonicalScope: scope, osDisciplineId: ELECTRICAL.id, disciplineName: ELECTRICAL.name }],
        assignments: [{ osDisciplineId: ELECTRICAL.id, osPartnerId: 9001 }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect((await getTradeDictionary()).get(scope)).toMatchObject({ id: ELECTRICAL.id });
    expect((await getProjectAssignments(project.id)).get(ELECTRICAL.id)?.osPartnerId).toBe(9001);

    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);

  it("dismisses and restores a scope, idempotently", async () => {
    const project = await prisma.project.create({ data: { name: "Trades Dismiss Test" } });
    const scope = `ZZ Dismiss Scope ${Date.now()}`;

    await dismissScope(project.id, scope);
    expect(await getDismissedScopes(project.id)).toContain(scope);

    await dismissScope(project.id, scope);
    expect(await prisma.tradeScopeDismissal.count({ where: { projectId: project.id, canonicalScope: scope } })).toBe(1);

    await restoreScope(project.id, scope);
    expect(await getDismissedScopes(project.id)).not.toContain(scope);

    await restoreScope(project.id, scope);

    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);

  it("scopes dismissal per project", async () => {
    const projectA = await prisma.project.create({ data: { name: "Trades Dismiss A" } });
    const projectB = await prisma.project.create({ data: { name: "Trades Dismiss B" } });
    const scope = `ZZ Shared Dismiss Scope ${Date.now()}`;

    await dismissScope(projectA.id, scope);
    expect(await getDismissedScopes(projectA.id)).toContain(scope);
    expect(await getDismissedScopes(projectB.id)).not.toContain(scope);

    await prisma.project.delete({ where: { id: projectA.id } });
    await prisma.project.delete({ where: { id: projectB.id } });
  }, 30000);

  it("dismiss/restore routes persist and remove a dismissal", async () => {
    const { POST: dismissRoute } = await import("@/app/api/trades/dismiss/route");
    const { POST: restoreRoute } = await import("@/app/api/trades/restore/route");
    const project = await prisma.project.create({ data: { name: "Trades Dismiss Route Test" } });
    const scope = `ZZ Dismiss Route Scope ${Date.now()}`;

    const dismissReq = new Request("http://localhost/api/trades/dismiss", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, canonicalScope: scope }),
    });
    const dismissRes = await dismissRoute(dismissReq);
    expect(dismissRes.status).toBe(200);
    expect(await getDismissedScopes(project.id)).toContain(scope);

    const restoreReq = new Request("http://localhost/api/trades/restore", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, canonicalScope: scope }),
    });
    const restoreRes = await restoreRoute(restoreReq);
    expect(restoreRes.status).toBe(200);
    expect(await getDismissedScopes(project.id)).not.toContain(scope);

    const badReq = new Request("http://localhost/api/trades/dismiss", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canonicalScope: scope }),
    });
    const badRes = await dismissRoute(badReq);
    expect(badRes.status).toBe(422);

    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);
});
