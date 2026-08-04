import { prisma } from "@/lib/db";

/**
 * The one status-date resolution used everywhere a forecast runs (schedule
 * body, buckets, OS context packet): latest finalized update's as-of date,
 * else the import's status date, else the import timestamp.
 */
export async function resolveForecastStatusDate(
  projectId: string,
  imp: { statusDate: Date | null; importedAt: Date },
): Promise<Date> {
  const latestUpdate = await prisma.progressUpdate.findFirst({
    where: { projectId, state: "finalized" },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });
  return latestUpdate?.asOfDate ?? imp.statusDate ?? imp.importedAt;
}
