import { prisma } from "@/lib/db";
import { computeForecast } from "@/lib/forecast/computeForecast";
import { resolveForecastStatusDate } from "@/lib/forecast/resolveStatusDate";
import { baselineProgress } from "@/lib/lookahead/computeLookahead";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { minutesToDays } from "@/lib/msp/duration";
import { isLeafActive } from "@/lib/msp/types";
import { applyDictionary } from "@/lib/normalize/normalizationService";
import { phaseByActivityId } from "./activityPhase";
import { BUCKET_ORDER, groupIntoBuckets, type BucketKey } from "@/lib/schedule/weekBuckets";
import { getProjectAssignments, getProjectDisciplines, getTradeDictionary } from "@/lib/trades/tradesService";
import { getFinalizedEntries } from "@/lib/updates/updateService";

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
  // Nested under the partner row (never new top-level rows) so the 25-item OS
  // cap still holds one row per partner while procurement gets scope+phase
  // detail to match items against.
  scopeGroups: ScopeGroup[];
  activities: PacketActivity[];
};

// A single schedule activity, leaf-level detail nested under its partner's row.
export interface PacketActivity {
  key: string; // activity.canonicalActivityKey
  name: string;
  wbsCode: string | null;
  canonicalScope: string;
  phase: string | null;
  plannedStart: string | null;
  plannedFinish: string | null;
  isCritical: boolean;
  minFloatDays: number | null;
}

// One scope+phase group within a partner's row — the grain procurement matches
// items against.
export interface ScopeGroup {
  canonicalScope: string;
  phase: string | null;
  // CSI division code (e.g. "22A") so procurement can join to its own
  // Category.code. Null when the trade dictionary's discipline id has no
  // matching entry on the OS disciplines roster (or no division set there).
  division: string | null;
  firstActivityStart: string | null;
  lastActivityFinish: string | null;
  activityCount: number;
  isCritical: boolean;
}

// One card per activity, grouped by the same week buckets the schedule body
// shows (Task 1's groupIntoBuckets) — the OS week view and Connect's own view
// read off the same forecast layer instead of drifting apart.
export type WeekBucketCard = {
  name: string;
  partnerName: string | null;
  driftDays: number;
  expectedStart: string | null;
  expectedFinish: string | null;
  percentComplete: number | null;
};

export type ScheduleContextPacket = {
  items: ScheduleContextItem[];
  packetType: string;
  projectId: number;
  summary: Record<string, unknown>;
  warnings: string[];
};

type ScopeGroupAccum = {
  canonicalScope: string;
  phase: string | null;
  firstStart: Date | null;
  lastFinish: Date | null;
  activityCount: number;
  criticalCount: number;
};

type Bucket = {
  activityCount: number;
  criticalCount: number;
  firstStart: Date | null;
  lastFinish: Date | null;
  minFloatMinutes: number | null;
  partnerName: string;
  scopeGroups: Map<string, ScopeGroupAccum>; // key = JSON.stringify([scope, phase])
  activities: PacketActivity[];
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
    include: { activities: true, relationships: true },
  });
  if (!latestImport) {
    return empty("No schedule has been imported for this project yet.");
  }

  const leaves = latestImport.activities.filter(isLeafActive);
  const [{ mapped, unmappedNames }, tradeDictionary, assignments, disciplines] = await Promise.all([
    applyDictionary(leaves),
    getTradeDictionary(),
    getProjectAssignments(project.id),
    getProjectDisciplines(project.id),
  ]);
  const scopeByActivityId = new Map(mapped.map((m) => [m.activity.id, m.canonicalScope]));
  // Procurement joins on the CSI sub-code (e.g. "26A") — which the OS roster
  // carries as the PREFIX of the discipline `name` ("26A: ELECTRICAL"), NOT in
  // the roster's `division` field (that holds the broad division, "26 Electrical").
  // Parse the sub-code from the name; join scope -> discipline id -> code once.
  const csiCode = (name: string): string | null => name.match(/^\s*(\d{2}[A-Za-z])/)?.[1]?.toUpperCase() ?? null;
  const codeByDisciplineId = new Map(disciplines.map((d) => [d.id, csiCode(d.name)]));
  const divisionByScope = new Map<string, string>();
  for (const [scope, discipline] of tradeDictionary) {
    const code = codeByDisciplineId.get(discipline.id);
    if (code) divisionByScope.set(scope, code);
  }
  // Real top-level WBS phase groups ARE type "summary" rows — deriveSectionInfo
  // (inside phaseByActivityId) only sees what it's given, so the phase map has
  // to be built from the fuller set that keeps summaries, unlike `leaves`
  // (isLeafActive) which drops them. Same pattern as ScheduleBody.tsx:117-119.
  const phaseById = phaseByActivityId(
    latestImport.activities
      .filter((a) => a.type !== "project_summary")
      .map((a) => ({ id: a.id, outlineLevel: a.outlineLevel, outlineNumber: a.outlineNumber, name: a.name })),
  );

  const progressByKey = resolveCurrentProgress(await getFinalizedEntries(project.id));
  const dataDate = await resolveForecastStatusDate(project.id, latestImport);
  const forecasts = computeForecast({
    activities: latestImport.activities,
    relationships: latestImport.relationships,
    progressByKey,
    statusDate: dataDate,
    minutesPerDay: latestImport.minutesPerDay,
  });

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
      scopeGroups: new Map<string, ScopeGroupAccum>(),
      activities: [],
    };

    bucket.activityCount += 1;
    if (activity.isCritical) bucket.criticalCount += 1;
    bucket.firstStart = minOf(bucket.firstStart, activity.plannedStart);
    bucket.lastFinish = maxOf(bucket.lastFinish, activity.plannedFinish);
    bucket.minFloatMinutes = minOf(bucket.minFloatMinutes, activity.totalSlackMinutes);

    const phase = phaseById.get(activity.id) ?? null;
    const groupKey = JSON.stringify([canonicalScope, phase]);
    const g = bucket.scopeGroups.get(groupKey) ?? {
      canonicalScope,
      phase,
      firstStart: null as Date | null,
      lastFinish: null as Date | null,
      activityCount: 0,
      criticalCount: 0,
    };
    g.activityCount += 1;
    if (activity.isCritical) g.criticalCount += 1;
    g.firstStart = minOf(g.firstStart, activity.plannedStart);
    g.lastFinish = maxOf(g.lastFinish, activity.plannedFinish);
    bucket.scopeGroups.set(groupKey, g);

    bucket.activities.push({
      key: activity.canonicalActivityKey,
      name: activity.name,
      wbsCode: activity.wbsCode,
      canonicalScope,
      phase,
      plannedStart: activity.plannedStart?.toISOString() ?? null,
      plannedFinish: activity.plannedFinish?.toISOString() ?? null,
      isCritical: activity.isCritical,
      minFloatDays: roundDays(minutesToDays(activity.totalSlackMinutes, minutesPerDay)),
    });

    buckets.set(assignment.osPartnerId, bucket);
  }

  // Bound the nested leaf list per partner — a partner can carry hundreds of
  // activities and the packet has no cap on that dimension otherwise. Soonest
  // first, same "what's needed next" ordering as the top-level trade sort.
  const ACTIVITIES_PER_PARTNER_CAP = 100;
  const activityCapWarnings: string[] = [];
  for (const bucket of buckets.values()) {
    bucket.activities.sort((a, b) => {
      if (a.plannedStart && b.plannedStart) return a.plannedStart.localeCompare(b.plannedStart);
      if (a.plannedStart) return -1;
      if (b.plannedStart) return 1;
      return 0;
    });
    if (bucket.activities.length > ACTIVITIES_PER_PARTNER_CAP) {
      activityCapWarnings.push(
        `${bucket.partnerName} has ${bucket.activities.length} activities; the ${ACTIVITIES_PER_PARTNER_CAP} starting soonest are included.`,
      );
      bucket.activities = bucket.activities.slice(0, ACTIVITIES_PER_PARTNER_CAP);
    }
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
    scopeGroups: [...bucket.scopeGroups.values()].map((g) => ({
      canonicalScope: g.canonicalScope,
      phase: g.phase,
      division: divisionByScope.get(g.canonicalScope) ?? null,
      firstActivityStart: g.firstStart?.toISOString() ?? null,
      lastActivityFinish: g.lastFinish?.toISOString() ?? null,
      activityCount: g.activityCount,
      isCritical: g.criticalCount > 0,
    })),
    activities: bucket.activities,
  }));

  // Same forecast layer as the schedule body's own week buckets (Task 1), but
  // by activity rather than by trade: the OS week view wants "what's coming",
  // not a per-partner roll-up, and items alone can't say that (25-item cap).
  const CARD_CAP = 8;
  const bucketInputs = leaves.map((a) => {
    const f = forecasts.get(a.externalUid);
    const p = progressByKey.get(a.canonicalActivityKey) ?? baselineProgress(a);
    const scope = scopeByActivityId.get(a.id);
    const discipline = scope ? tradeDictionary.get(scope) : undefined;
    const partner = discipline ? assignments.get(discipline.id) : undefined;
    return {
      status: p.status,
      expectedStart: (f?.expectedStart ?? a.plannedStart)?.toISOString() ?? null,
      expectedFinish: (f?.expectedFinish ?? a.plannedFinish)?.toISOString() ?? null,
      card: {
        name: a.name,
        partnerName: partner?.name ?? null,
        driftDays: f?.driftDays ?? 0,
        expectedStart: (f?.expectedStart ?? a.plannedStart)?.toISOString() ?? null,
        expectedFinish: (f?.expectedFinish ?? a.plannedFinish)?.toISOString() ?? null,
        percentComplete: p.percentComplete ?? a.percentComplete,
      },
    };
  });
  const grouped = groupIntoBuckets(bucketInputs, dataDate);
  let bucketsTruncated = false;
  const weekBuckets = Object.fromEntries(
    BUCKET_ORDER.map((key: BucketKey) => {
      const all = grouped[key];
      if (key !== "done" && all.length > CARD_CAP) bucketsTruncated = true;
      return [key, { count: all.length, cards: key === "done" ? [] : all.slice(0, CARD_CAP).map((b) => b.card) }];
    }),
  ) as Record<BucketKey, { count: number; cards: WeekBucketCard[] }>;

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
  if (bucketsTruncated) {
    warnings.push(`Week buckets list up to ${CARD_CAP} activities each; counts cover all.`);
  }
  warnings.push(...activityCapWarnings);

  return {
    items,
    packetType: SCHEDULE_PACKET_TYPE,
    projectId: osProjectId,
    summary: {
      activityCount: leaves.length,
      dataDate: dataDate.toISOString(),
      importedAt: latestImport.importedAt.toISOString(),
      projectFinish: latestImport.projectFinish?.toISOString() ?? null,
      scheduledTradeCount: ordered.length,
      weekBuckets,
    },
    warnings,
  };
}

function minOf<T extends Date | number>(current: T | null, candidate: T | null): T | null {
  if (candidate === null || candidate === undefined) return current;
  return current === null || candidate < current ? candidate : current;
}

function maxOf<T extends Date | number>(current: T | null, candidate: T | null): T | null {
  if (candidate === null || candidate === undefined) return current;
  return current === null || candidate > current ? candidate : current;
}

function roundDays(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}
