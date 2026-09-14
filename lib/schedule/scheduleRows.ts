import { prisma } from "@/lib/db";
import { computeForecast, projectDrift } from "@/lib/forecast/computeForecast";
import { resolveForecastStatusDate } from "@/lib/forecast/resolveStatusDate";
import { baselineProgress } from "@/lib/lookahead/computeLookahead";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { getDictionary } from "@/lib/normalize/normalizationService";
import { normalizeName } from "@/lib/normalize/normalizeName";
import type { AtRiskItem } from "@/lib/procurement/display";
import {
  isActivityAtRisk,
  resolveActivityTrades,
  shouldShowProcurementRiskLine,
} from "@/lib/trades/activityTrades";
import type { ScheduleRow, RowStatus } from "./types";

export interface ScheduleData {
  rows: ScheduleRow[];
  projectDriftDays: number;
  atRiskCount: number;
  statusDate: string;
  riskFetchedAt: Date | null;
}

function toDays(minutes: number | null, minutesPerDay: number | null): number | null {
  if (minutes === null || !minutesPerDay) return null;
  return minutes / minutesPerDay;
}

/**
 * The one server-side assembly for the schedule body (spec §3): activities,
 * progress, trades, procurement flags, and the forecast layer in a single
 * pass — the import's activities and relationships load exactly once here,
 * and computeForecast runs on that same load.
 */
export async function getScheduleData(projectId: string): Promise<ScheduleData | null> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: { orderBy: { wbsCode: "asc" } }, relationships: true },
  });
  if (!latest) return null;

  const progressByKey = resolveCurrentProgress(await getFinalizedEntries(projectId));
  const statusDate = await resolveForecastStatusDate(projectId, latest);

  const forecasts = computeForecast({
    activities: latest.activities,
    relationships: latest.relationships,
    progressByKey,
    statusDate,
    minutesPerDay: latest.minutesPerDay,
  });
  const drift = projectDrift(latest.activities, forecasts, progressByKey);

  const scopeDict = await getDictionary();
  const trades = await resolveActivityTrades(
    projectId,
    latest.activities.map((a) => ({ id: a.id, name: a.name })),
  );
  const procurementRisk = await prisma.osProcurementRisk.findMany({
    where: { projectId },
    select: {
      osPartnerId: true,
      itemCount: true,
      behindCount: true,
      submittalLateCount: true,
      projectedLateCount: true,
      releasedAtRiskCount: true,
      missingDatesCount: true,
      atRiskActivityKeys: true,
      atRiskActivities: true,
      fetchedAt: true,
    },
  });
  const flaggedActivityKeys = new Set(procurementRisk.flatMap((r) => r.atRiskActivityKeys));
  // activityKey -> the specific behind item linked to it, for the AT RISK cause
  // line. Flattened across partners; a key belongs to exactly one item here.
  const atRiskItemByKey = new Map<string, AtRiskItem>(
    procurementRisk.flatMap((r) =>
      ((r.atRiskActivities as unknown as { activityKey: string; requiredOnSite: string | null; state: string }[]) ?? [])
        .map((a) => [a.activityKey, { requiredOnSite: a.requiredOnSite, state: a.state }] as const),
    ),
  );
  const procurementByPartner = new Map(
    procurementRisk.map((r) => [
      r.osPartnerId,
      {
        itemCount: r.itemCount,
        behindCount: r.behindCount,
        submittalLateCount: r.submittalLateCount,
        projectedLateCount: r.projectedLateCount,
        releasedAtRiskCount: r.releasedAtRiskCount,
        missingDatesCount: r.missingDatesCount,
      },
    ]),
  );
  const riskFetchedAt = shouldShowProcurementRiskLine(procurementRisk.length > 0, trades.values())
    ? procurementRisk[0]?.fetchedAt ?? null
    : null;

  // "Pushed by X" quotes the standard name when one exists — same preference
  // as the row's own display name.
  const nameByUid = new Map(
    latest.activities.map((a) => [a.externalUid, scopeDict.get(normalizeName(a.name)) ?? a.name]),
  );
  const mpd = latest.minutesPerDay ?? 480;

  const rows: ScheduleRow[] = latest.activities.map((a) => {
    const progress = progressByKey.get(a.canonicalActivityKey) ?? baselineProgress(a);
    const percentComplete = progress.percentComplete ?? a.percentComplete;
    const partnerId = trades.get(a.id)?.osPartnerId ?? null;
    const f = forecasts.get(a.externalUid);
    const status: RowStatus = progress.status;
    const atRisk = isActivityAtRisk(a.canonicalActivityKey, percentComplete, flaggedActivityKeys);
    return {
      id: a.id,
      externalId: a.externalId,
      wbsCode: a.wbsCode,
      name: a.name,
      canonicalScope: scopeDict.get(normalizeName(a.name)) ?? null,
      disciplineName: trades.get(a.id)?.disciplineName ?? null,
      partnerName: trades.get(a.id)?.partnerName ?? null,
      atRisk,
      atRiskItem: atRisk && a.canonicalActivityKey ? atRiskItemByKey.get(a.canonicalActivityKey) ?? null : null,
      procurement: partnerId === null ? null : procurementByPartner.get(partnerId) ?? null,
      type: a.type,
      isCritical: a.isCritical,
      outlineLevel: a.outlineLevel,
      plannedStart: a.plannedStart ? a.plannedStart.toISOString() : null,
      plannedFinish: a.plannedFinish ? a.plannedFinish.toISOString() : null,
      expectedStart: f?.expectedStart ? f.expectedStart.toISOString() : a.plannedStart?.toISOString() ?? null,
      expectedFinish: f?.expectedFinish ? f.expectedFinish.toISOString() : a.plannedFinish?.toISOString() ?? null,
      driftDays: f?.driftDays ?? 0,
      pushedByName: f?.pushedByUid != null ? nameByUid.get(f.pushedByUid) ?? null : null,
      status,
      percentComplete,
      totalSlackDays: toDays(a.totalSlackMinutes, mpd),
      durationDays: a.durationDays,
      customFields: (a.customFields as Record<string, string>) ?? {},
    };
  });

  return {
    rows,
    projectDriftDays: drift.driftDays,
    atRiskCount: rows.filter((r) => r.atRisk).length,
    statusDate: statusDate.toISOString(),
    riskFetchedAt,
  };
}
