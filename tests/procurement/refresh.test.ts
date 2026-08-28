import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/lib/os-gateway", () => ({
  mintServiceToken: vi.fn(async () => "fake-service-token"),
  getProcurementSummary: vi.fn(async () => ({
    packetType: "procurement_project_summary",
    projectId: 990000,
    items: [
      {
        osPartnerId: 1, partnerName: "New Co", itemCount: 3,
        earliestRequiredOnSite: null, leastAdvancedState: "submitted",
        behindCount: 2, submittalLateCount: 2, projectedLateCount: 0,
        releasedAtRiskCount: 0, missingDatesCount: 0,
      },
      {
        osPartnerId: 2, partnerName: "Second Co", itemCount: 1,
        earliestRequiredOnSite: null, leastAdvancedState: "release",
        behindCount: 0, submittalLateCount: 0, projectedLateCount: 0,
        releasedAtRiskCount: 0, missingDatesCount: 0,
      },
    ],
    summary: {},
    warnings: [],
  })),
}));

import { refreshProcurementRiskIfStale } from "@/lib/procurement/refresh";

describe.runIf(!!process.env.DATABASE_URL)("refreshProcurementRiskIfStale", () => {
  it("refreshes when stale and upserts by partner", async () => {
    const project = await prisma.project.create({ data: { name: `zz-refresh-${Date.now()}`, osProjectId: 990000 + (Date.now() % 1000) } });
    await prisma.osProcurementRisk.create({ data: { projectId: project.id, osPartnerId: 1, partnerName: "Old", itemCount: 1, behindCount: 0, submittalLateCount: 0, projectedLateCount: 0, releasedAtRiskCount: 0, missingDatesCount: 0, leastAdvancedState: "release", fetchedAt: new Date(Date.now() - 3600_000) } });
    expect(await refreshProcurementRiskIfStale(project)).toBe("refreshed");
    const rows = await prisma.osProcurementRisk.findMany({ where: { projectId: project.id }, orderBy: { osPartnerId: "asc" } });
    expect(rows.map((r) => [r.osPartnerId, r.behindCount])).toEqual([[1, 2], [2, 0]]);   // partner 1 updated in place, partner 2 added
    expect(await refreshProcurementRiskIfStale(project)).toBe("fresh");
    await prisma.project.delete({ where: { id: project.id } });
  });
});
