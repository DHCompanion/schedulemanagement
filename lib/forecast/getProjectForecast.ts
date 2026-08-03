import { prisma } from "@/lib/db";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import {
  computeForecast,
  projectDrift,
  type ActivityForecast,
  type ProjectDrift,
} from "./computeForecast";

export interface ProjectForecast {
  forecastsByUid: Map<number, ActivityForecast>;
  project: ProjectDrift;
  statusDate: Date;
}

/**
 * The one shared forecast entry point (spec §1): schedule body, buckets, stat
 * strip, OS context packet, and the lookahead PDF all read these numbers.
 * Status date preference: latest finalized update's as-of date, else the
 * import's status date, else the import timestamp.
 */
export async function getProjectForecast(projectId: string): Promise<ProjectForecast | null> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true, relationships: true },
  });
  if (!latest) return null;

  const progressByKey = resolveCurrentProgress(await getFinalizedEntries(projectId));
  const latestUpdate = await prisma.progressUpdate.findFirst({
    where: { projectId, state: "finalized" },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });
  const statusDate = latestUpdate?.asOfDate ?? latest.statusDate ?? latest.importedAt;

  const forecastsByUid = computeForecast({
    activities: latest.activities,
    relationships: latest.relationships,
    progressByKey,
    statusDate,
    minutesPerDay: latest.minutesPerDay,
  });
  return {
    forecastsByUid,
    project: projectDrift(latest.activities, forecastsByUid, progressByKey),
    statusDate,
  };
}
