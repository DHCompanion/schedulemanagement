// Schedule Manager's answer to Connect's update-state read (lib/gateway/contract.ts): the lookahead as of a
// data date, what is due and late, and the open draft update. The same functions as the draft update screen
// and the schedule body, so an agent sees what a person sees. Schedule data only: no procurement, people or notes.
import { prisma } from "@/lib/db";
import { computeForecast, type ActivityForecast } from "@/lib/forecast/computeForecast";
import { resolveForecastStatusDate } from "@/lib/forecast/resolveStatusDate";
import { computeLookahead, type ActivityProgress, type LookaheadRow } from "@/lib/lookahead/computeLookahead";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";

export const DEFAULT_LOOKAHEAD_WEEKS = 1;
const MAX_ACTIVITIES = 40; // the contract's activities maxItems
const MAX_KEY = 300; // the contract's key maxLength; a longer key is left out, never cut

export type UpdateStateInput = { asOfDate?: string; lookaheadWeeks?: number };
type DraftEntry = { canonicalActivityKey: string; status: string; percentComplete: number | null; actualStart: Date | null; actualFinish: Date | null };
export type UpdateStateSource = {
  asOf: Date;
  weeks: number;
  importedAt: Date | null;
  lastFinalizedAsOf: Date | null;
  draft: { asOfDate: Date; lookaheadWeeks: number; updatedAt: Date; entries: DraftEntry[] } | null;
  rows: LookaheadRow[];
  activityByUid: Map<number, { isCritical: boolean; isMilestone: boolean }>;
  forecasts: Map<number, ActivityForecast>;
};

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const pct = (n: number | null | undefined) => (n == null ? null : Math.min(100, Math.max(0, Math.round(n))));
const STATUSES = new Set(["not_started", "in_progress", "complete"]);
const status = (s: string) => (STATUSES.has(s) ? s : "not_started");

/** YYYY-MM-DD as UTC midnight, or null if it is not a real calendar date. */
export function parseDay(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return day(d) === s ? d : null;
}

/** Contract-shaped data: late, then due, then expected start; whole activities dropped from the end to fit. */
export function toResult(src: UpdateStateSource, fits: (data: unknown) => boolean) {
  const draftByKey = new Map((src.draft?.entries ?? []).map((e) => [e.canonicalActivityKey, e]));
  const late = (r: LookaheadRow) => r.slippage !== "on-track";
  const rank = (r: LookaheadRow) => (late(r) ? 0 : r.dueByDataDate ? 1 : 2);
  const expected = (r: LookaheadRow) => src.forecasts.get(r.externalUid)?.expectedStart ?? r.progress.forecastStart ?? r.plannedStart;
  const sorted = [...src.rows].sort((a, b) =>
    rank(a) - rank(b) ||
    (expected(a)?.getTime() ?? Infinity) - (expected(b)?.getTime() ?? Infinity) ||
    a.canonicalActivityKey.localeCompare(b.canonicalActivityKey));
  const activities = sorted
    .filter((r) => r.canonicalActivityKey.length > 0 && r.canonicalActivityKey.length <= MAX_KEY)
    .slice(0, MAX_ACTIVITIES)
    .map((r) => {
      const f = src.forecasts.get(r.externalUid), a = src.activityByUid.get(r.externalUid), d = draftByKey.get(r.canonicalActivityKey);
      return {
        key: r.canonicalActivityKey,
        name: (r.name.trim() || r.canonicalActivityKey).slice(0, 200),
        wbsCode: r.wbsCode?.trim() ? r.wbsCode.trim().slice(0, 60) : null,
        isCritical: a?.isCritical ?? false,
        isMilestone: a?.isMilestone ?? false,
        plannedStart: day(r.plannedStart),
        plannedFinish: day(r.plannedFinish),
        expectedStart: day(f?.expectedStart ?? r.progress.forecastStart ?? r.plannedStart),
        expectedFinish: day(f?.expectedFinish ?? r.progress.forecastFinish ?? r.plannedFinish),
        driftDays: Math.min(10000, Math.max(-10000, Math.round(f?.driftDays ?? 0))),
        status: status(r.progress.status),
        percentComplete: pct(r.progress.percentComplete),
        slippage: r.slippage,
        dueByDataDate: r.dueByDataDate,
        draft: d ? { status: status(d.status), percentComplete: pct(d.percentComplete), actualStart: day(d.actualStart), actualFinish: day(d.actualFinish) } : null,
      };
    });
  const data = {
    asOfDate: day(src.asOf)!,
    lookaheadWeeks: src.weeks,
    scheduleImportedAt: src.importedAt?.toISOString() ?? null,
    lastFinalizedAsOf: day(src.lastFinalizedAsOf),
    draftUpdate: src.draft
      ? { asOfDate: day(src.draft.asOfDate)!, lookaheadWeeks: Math.min(6, Math.max(1, src.draft.lookaheadWeeks)), entryCount: src.draft.entries.length, updatedAt: src.draft.updatedAt.toISOString() }
      : null,
    counts: { lookahead: src.rows.length, due: src.rows.filter((r) => r.dueByDataDate).length, late: src.rows.filter(late).length },
    activities,
    truncated: activities.length < src.rows.length,
  };
  while (data.activities.length && !fits(data)) {
    data.activities.pop();
    data.truncated = true;
  }
  return data;
}

/** Everything toResult needs for one Connect project, read the way the update screen reads it. */
export async function loadUpdateState(osProjectId: number, input: UpdateStateInput, today = new Date()): Promise<UpdateStateSource> {
  const weeks = input.lookaheadWeeks ?? DEFAULT_LOOKAHEAD_WEEKS;
  const requested = input.asOfDate ? parseDay(input.asOfDate) : null;
  const empty = (): UpdateStateSource => ({
    asOf: requested ?? parseDay(day(today)!)!, weeks, importedAt: null, lastFinalizedAsOf: null, draft: null,
    rows: [], activityByUid: new Map(), forecasts: new Map(),
  });
  // Scoped through the local project bound to this Connect project; nothing linked is an honest empty answer.
  const project = await prisma.project.findUnique({ where: { osProjectId }, select: { id: true } });
  if (!project) return empty();
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId: project.id },
    orderBy: { importedAt: "desc" },
    include: { activities: true, relationships: true },
  });
  if (!latest) return empty();

  const asOf = requested ?? (await resolveForecastStatusDate(project.id, latest));
  const [finalized, lastFinalized, draft] = await Promise.all([
    getFinalizedEntries(project.id).then(resolveCurrentProgress),
    prisma.progressUpdate.findFirst({ where: { projectId: project.id, state: "finalized" }, orderBy: { asOfDate: "desc" }, select: { asOfDate: true } }),
    prisma.progressUpdate.findFirst({
      where: { projectId: project.id, state: "draft" },
      select: { asOfDate: true, lookaheadWeeks: true, updatedAt: true, entries: { select: { canonicalActivityKey: true, status: true, percentComplete: true, actualStart: true, actualFinish: true } } },
    }),
  ]);
  const progress: Map<string, ActivityProgress> = finalized;
  const forecasts = computeForecast({ activities: latest.activities, relationships: latest.relationships, progressByKey: progress, statusDate: asOf, minutesPerDay: latest.minutesPerDay });
  // Committed progress drives the rows; the open draft's edits ride along per activity, and every activity the
  // draft touched stays in the list, as on the update screen.
  const rows = computeLookahead(latest.activities, progress, asOf, weeks, new Set(draft?.entries.map((e) => e.canonicalActivityKey) ?? []));
  return {
    asOf, weeks, importedAt: latest.importedAt, lastFinalizedAsOf: lastFinalized?.asOfDate ?? null, draft, rows, forecasts,
    activityByUid: new Map(latest.activities.map((a) => [a.externalUid, { isCritical: a.isCritical, isMilestone: a.isMilestone }])),
  };
}
