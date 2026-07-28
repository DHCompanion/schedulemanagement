import { isLeafActive } from "@/lib/completeness/completenessService";
import { prisma } from "@/lib/db";
import { minutesToDays } from "@/lib/msp/duration";
import { applyDictionary } from "@/lib/normalize/normalizationService";
import { getProjectAssignments, getTradeDictionary } from "@/lib/trades/tradesService";

// The only packet type this tool exposes. Declared in the OS registry as
// schedule-manager's contextExposures entry; anything else is rejected.
export const SCHEDULE_PACKET_TYPE = "project_schedule_summary";

const DEFAULT_MINUTES_PER_DAY = 480;

// One row per trade partner, not per activity. A CPM schedule holds thousands of
// activities and the OS caps a context packet at 25 items — but a project runs
// 10-15 trade partners, so this grain covers the whole schedule inside the cap.
// The consumer (procurement) keeps its own item detail and needs only our anchor
// date per trade to check its required-on-site dates against.
export type ScheduleContextItem = {
  activityCount: number;
  firstActivityStart: string | null;
  isCritical: boolean;
  lastActivityFinish: string | null;
  minFloatDays: number | null;
  osPartnerId: number;
  partnerName: string;
  // The OS project id, not ours. The OS re-checks every item's projectId against
  // the session it authorized, so carrying it here is what lets that check work.
  projectId: number;
};

export type ScheduleContextPacket = {
  items: ScheduleContextItem[];
  packetType: string;
  projectId: number;
  summary: Record<string, unknown>;
  warnings: string[];
};

type Bucket = {
  activityCount: number;
  criticalCount: number;
  firstStart: Date | null;
  lastFinish: Date | null;
  minFloatMinutes: number | null;
  partnerName: string;
};

/**
 * Builds the packet for one OS project.
 *
 * Every query is scoped through the local project resolved from osProjectId —
 * the tool-side scoping obligation in EXTERNAL_TOOL_CONTEXT_ENDPOINT.md §4.
 * A project that is not linked, or has no schedule yet, is a normal empty packet
 * with a warning rather than an error: the OS asked a fair question and the
 * honest answer is "nothing yet".
 */
export async function buildScheduleContextPacket(osProjectId: number, limit: number): Promise<ScheduleContextPacket> {
  const empty = (warning: string): ScheduleContextPacket => ({
    items: [],
    packetType: SCHEDULE_PACKET_TYPE,
    projectId: osProjectId,
    summary: { activityCount: 0, dataDate: null, tradeCount: 0 },
    warnings: [warning],
  });

  const project = await prisma.project.findUnique({ where: { osProjectId } });
  if (!project) {
    return empty("No schedule project is linked to this Connect project yet.");
  }

  const latestImport = await prisma.scheduleImport.findFirst({
    orderBy: { importedAt: "desc" },
    where: { projectId: project.id },
    include: { activities: true },
  });
  if (!latestImport) {
    return empty("No schedule has been imported for this project yet.");
  }

  const leaves = latestImport.activities.filter(isLeafActive);
  const [{ mapped, unmappedNames }, tradeDictionary, assignments] = await Promise.all([
    applyDictionary(leaves),
    getTradeDictionary(),
    getProjectAssignments(project.id),
  ]);

  const minutesPerDay = latestImport.minutesPerDay ?? DEFAULT_MINUTES_PER_DAY;
  const buckets = new Map<number, Bucket>();
  let unassignedDisciplineCount = 0;

  for (const { activity, canonicalScope } of mapped) {
    const discipline = tradeDictionary.get(canonicalScope);
    if (!discipline) continue;

    const assignment = assignments.get(discipline.id);
    if (!assignment) {
      // Mapped to a trade, but nobody is assigned to it on this project yet.
      unassignedDisciplineCount += 1;
      continue;
    }

    const bucket = buckets.get(assignment.osPartnerId) ?? {
      activityCount: 0,
      criticalCount: 0,
      firstStart: null,
      lastFinish: null,
      minFloatMinutes: null,
      partnerName: assignment.name,
    };

    bucket.activityCount += 1;
    if (activity.isCritical) bucket.criticalCount += 1;
    bucket.firstStart = earlier(bucket.firstStart, activity.plannedStart);
    bucket.lastFinish = later(bucket.lastFinish, activity.plannedFinish);
    bucket.minFloatMinutes = smaller(bucket.minFloatMinutes, activity.totalSlackMinutes);

    buckets.set(assignment.osPartnerId, bucket);
  }

  // Soonest-starting trade first: the one whose material is needed next is the
  // one procurement most needs to see. Trades with no dated activity sort last.
  const ordered = [...buckets.entries()].sort(([, a], [, b]) => {
    if (a.firstStart && b.firstStart) return a.firstStart.getTime() - b.firstStart.getTime();
    if (a.firstStart) return -1;
    if (b.firstStart) return 1;
    return a.partnerName.localeCompare(b.partnerName);
  });

  const items: ScheduleContextItem[] = ordered.slice(0, limit).map(([osPartnerId, bucket]) => ({
    activityCount: bucket.activityCount,
    firstActivityStart: bucket.firstStart?.toISOString() ?? null,
    isCritical: bucket.criticalCount > 0,
    lastActivityFinish: bucket.lastFinish?.toISOString() ?? null,
    minFloatDays: roundDays(minutesToDays(bucket.minFloatMinutes, minutesPerDay)),
    osPartnerId,
    partnerName: bucket.partnerName,
    projectId: osProjectId,
  }));

  const warnings: string[] = [];
  if (ordered.length > items.length) {
    warnings.push(`${ordered.length} trades have scheduled work; the ${items.length} starting soonest are included.`);
  }
  if (unmappedNames.length > 0) {
    warnings.push(`${unmappedNames.length} activity names are not mapped to a scope and are not counted.`);
  }
  if (unassignedDisciplineCount > 0) {
    warnings.push(`${unassignedDisciplineCount} activities map to a trade with no partner assigned on this project.`);
  }

  return {
    items,
    packetType: SCHEDULE_PACKET_TYPE,
    projectId: osProjectId,
    summary: {
      activityCount: leaves.length,
      dataDate: (latestImport.statusDate ?? latestImport.importedAt).toISOString(),
      importedAt: latestImport.importedAt.toISOString(),
      projectFinish: latestImport.projectFinish?.toISOString() ?? null,
      scheduledTradeCount: ordered.length,
    },
    warnings,
  };
}

function earlier(current: Date | null, candidate: Date | null): Date | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate < current ? candidate : current;
}

function later(current: Date | null, candidate: Date | null): Date | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate > current ? candidate : current;
}

function smaller(current: number | null, candidate: number | null): number | null {
  if (candidate === null || candidate === undefined) return current;
  if (current === null) return candidate;
  return candidate < current ? candidate : current;
}

function roundDays(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}
