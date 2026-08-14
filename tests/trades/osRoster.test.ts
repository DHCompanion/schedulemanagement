import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { GET } from "@/app/launch/route";
import { prisma } from "@/lib/db";
import { getProjectDisciplines, getPartnersForDiscipline } from "@/lib/trades/tradesService";

const hasDb = !!process.env.DATABASE_URL;
const OS_PROJECT_ID = 771001;

process.env.SESSION_SIGNING_SECRET ||= "roster-test-secret".padEnd(32, "x");
process.env.SKILES_OS_APP_ORIGIN ||= "https://sgconnect.dev";
process.env.SKILES_OS_API_BASE_URL ||= "https://api.sgconnect.dev/api";

function stubGateway(partners: unknown, options: { partnersFail?: boolean } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/project-context")) {
        return {
          ok: true,
          json: async () => ({
            project: { id: OS_PROJECT_ID, name: "Roster Test" },
            person: { id: 7 },
            access: { toolLevel: "user" },
          }),
        };
      }
      if (options.partnersFail) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ projectId: OS_PROJECT_ID, tradePartners: partners }) };
    })
  );
}

const launch = () => GET(new Request("https://tool.test/launch?token=t", { headers: { "x-forwarded-host": "t.test" } }));

describe.runIf(hasDb)("OS trade partner roster", () => {
  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { osProjectId: OS_PROJECT_ID } });
    await prisma.$disconnect();
  });

  it("caches the roster at launch and offers it, withholding do-not-use partners", async () => {
    stubGateway([
      { id: 1, name: "Acme Mechanical", doNotUse: false, disciplines: [{ id: 3, name: "HVAC", division: "23" }] },
      { id: 2, name: "Barred Electric", doNotUse: true, disciplines: [] },
    ]);
    await launch();

    const project = await prisma.project.findUnique({ where: { osProjectId: OS_PROJECT_ID } });
    expect(await prisma.osTradePartner.count({ where: { projectId: project!.id } })).toBe(2);

    // The do-not-use partner is cached but contributes neither a discipline nor
    // a candidate company.
    expect(await getProjectDisciplines(project!.id)).toEqual([{ id: 3, name: "HVAC", division: "23" }]);
    expect(await getPartnersForDiscipline(project!.id, 3)).toEqual([{ osPartnerId: 1, name: "Acme Mechanical" }]);
  });

  it("replaces the roster on the next launch so removals disappear", async () => {
    stubGateway([{ id: 9, name: "Replacement Plumbing", doNotUse: false, disciplines: [] }]);
    await launch();

    const project = await prisma.project.findUnique({ where: { osProjectId: OS_PROJECT_ID } });
    expect(await prisma.osTradePartner.findMany({ where: { projectId: project!.id }, select: { name: true } }))
      .toEqual([{ name: "Replacement Plumbing" }]);
  });

  it("keeps the cached roster and still completes the launch when the feed fails", async () => {
    stubGateway([], { partnersFail: true });
    const res = await launch();

    // A dead roster call must not cost the user their session.
    expect(res.status).toBe(303);
    const project = await prisma.project.findUnique({ where: { osProjectId: OS_PROJECT_ID } });
    expect(await prisma.osTradePartner.findMany({ where: { projectId: project!.id }, select: { name: true } }))
      .toEqual([{ name: "Replacement Plumbing" }]);
  });

  it("has no disciplines at all for a project with no OS roster", async () => {
    // There is no local vocabulary to fall back to any more — a project that was
    // never launched from Connect has nothing to assign.
    const standalone = await prisma.project.create({ data: { name: "Roster Test Standalone" } });

    expect(await getProjectDisciplines(standalone.id)).toEqual([]);
    expect(await getPartnersForDiscipline(standalone.id, 3)).toEqual([]);

    await prisma.project.delete({ where: { id: standalone.id } });
  });
});
