import { prisma } from "@/lib/db";
import { getProcurementSummary, mintServiceToken, type OsProcurementSummary } from "@/lib/os-gateway";

export async function upsertProcurementRisk(projectId: string, packet: OsProcurementSummary): Promise<void> {
  // An empty packet is "nothing to say" (e.g. a transient hiccup, or no
  // procurement project linked) — not "every partner departed". Leave the
  // cache exactly as it was rather than reading that silence as a wipe.
  if (packet.items.length === 0) return;
  const now = new Date();
  const osPartnerIds = packet.items.map((item) => item.osPartnerId);
  await prisma.$transaction([
    // A non-empty packet IS authoritative for the partners it's silent about:
    // drop any cached row for a partner no longer in it.
    prisma.osProcurementRisk.deleteMany({ where: { projectId, osPartnerId: { notIn: osPartnerIds } } }),
    ...packet.items.map((item) => prisma.osProcurementRisk.upsert({
      where: { projectId_osPartnerId: { projectId, osPartnerId: item.osPartnerId } },
      update: { partnerName: item.partnerName, itemCount: item.itemCount, behindCount: item.behindCount, submittalLateCount: item.submittalLateCount, projectedLateCount: item.projectedLateCount, releasedAtRiskCount: item.releasedAtRiskCount, missingDatesCount: item.missingDatesCount, earliestRequiredOnSite: item.earliestRequiredOnSite ? new Date(item.earliestRequiredOnSite) : null, leastAdvancedState: item.leastAdvancedState, fetchedAt: now },
      create: { projectId, osPartnerId: item.osPartnerId, partnerName: item.partnerName, itemCount: item.itemCount, behindCount: item.behindCount, submittalLateCount: item.submittalLateCount, projectedLateCount: item.projectedLateCount, releasedAtRiskCount: item.releasedAtRiskCount, missingDatesCount: item.missingDatesCount, earliestRequiredOnSite: item.earliestRequiredOnSite ? new Date(item.earliestRequiredOnSite) : null, leastAdvancedState: item.leastAdvancedState, fetchedAt: now },
    })),
  ]);
}

// Page-load refresh without a human token: mint a service session. Never throws — a
// failed refresh leaves the previous cache (and its honest "as of" line) in place.
export async function refreshProcurementRiskIfStale(project: { id: string; osProjectId: number | null }, maxAgeMs = 10 * 60_000): Promise<"fresh" | "refreshed" | "skipped"> {
  if (project.osProjectId == null) return "skipped";
  const latest = await prisma.osProcurementRisk.findFirst({ where: { projectId: project.id }, orderBy: { fetchedAt: "desc" }, select: { fetchedAt: true } });
  if (latest && Date.now() - latest.fetchedAt.getTime() < maxAgeMs) return "fresh";
  try {
    const token = await mintServiceToken(project.osProjectId);
    await upsertProcurementRisk(project.id, await getProcurementSummary(token));
    return "refreshed";
  } catch (error) {
    console.error("[schedule-manager] procurement risk refresh skipped:", error instanceof Error ? error.message : error);
    return "skipped";
  }
}
