export type ProgressStatus = "not_started" | "in_progress" | "complete";
export type SlippageFlag = "overdue" | "should-have-started" | "on-track";

export interface ActivityProgress {
  status: ProgressStatus;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number | null;
  note: string | null;
  // Revised dates the user accepted for not-started work (update review screen).
  // They stand in for the planned dates everywhere except drift, which stays against plan.
  forecastStart?: Date | null;
  forecastFinish?: Date | null;
}

export interface LookaheadActivity {
  externalUid: number;
  canonicalActivityKey: string;
  wbsCode: string | null;
  name: string;
  type: string;
  isActive: boolean;
  plannedStart: Date | null;
  plannedFinish: Date | null;
  // Actuals already recorded in the imported base schedule. Used as the starting
  // progress when no in-app update has touched the activity yet.
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number | null;
}

export interface LookaheadRow {
  externalUid: number;
  canonicalActivityKey: string;
  wbsCode: string | null;
  name: string;
  type: string;
  plannedStart: Date | null;
  plannedFinish: Date | null;
  progress: ActivityProgress;
  slippage: SlippageFlag;
  // Default update view: incomplete work that should have started by the data date, or is underway.
  dueByDataDate: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export function defaultProgress(): ActivityProgress {
  return { status: "not_started", actualStart: null, actualFinish: null, percentComplete: null, note: null };
}

/** Starting progress derived from the imported base schedule's own actuals. */
export function baselineProgress(
  a: Pick<LookaheadActivity, "actualStart" | "actualFinish" | "percentComplete">,
): ActivityProgress {
  let status: ProgressStatus = "not_started";
  if (a.actualFinish || a.percentComplete === 100) status = "complete";
  else if (a.actualStart || (a.percentComplete ?? 0) > 0) status = "in_progress";
  return { status, actualStart: a.actualStart, actualFinish: a.actualFinish, percentComplete: a.percentComplete, note: null };
}

export function computeSlippage(a: LookaheadActivity, p: ActivityProgress, asOfDate: Date): SlippageFlag {
  const start = p.forecastStart ?? a.plannedStart;
  const finish = p.forecastFinish ?? a.plannedFinish;
  if (finish && finish < asOfDate && p.status !== "complete") return "overdue";
  if (start && start < asOfDate && p.status === "not_started") return "should-have-started";
  return "on-track";
}

export function computeLookahead(
  activities: LookaheadActivity[],
  progressByKey: Map<string, ActivityProgress>,
  asOfDate: Date,
  weeks: number,
  alwaysInclude: Set<string> = new Set(),
): LookaheadRow[] {
  const windowEnd = new Date(asOfDate.getTime() + weeks * WEEK_MS);
  // The data date is a calendar day: work planned for any time that day is due by it.
  const dataDayEnd = new Date(asOfDate.getTime() + DAY_MS);
  const rows: LookaheadRow[] = [];
  for (const a of activities) {
    if (a.type === "summary" || a.type === "project_summary") continue;
    if (!a.isActive) continue;
    const progress = progressByKey.get(a.canonicalActivityKey) ?? baselineProgress(a);
    const plannedStart = progress.forecastStart ?? a.plannedStart;
    const plannedFinish = progress.forecastFinish ?? a.plannedFinish;
    const inProgress = progress.status === "in_progress" || (!!progress.actualStart && !progress.actualFinish);
    const startsInWindow = !!plannedStart && plannedStart >= asOfDate && plannedStart <= windowEnd;
    const finishesInWindow = !!plannedFinish && plannedFinish >= asOfDate && plannedFinish <= windowEnd;
    const spansWindow = !!plannedStart && !!plannedFinish && plannedStart <= asOfDate && plannedFinish >= asOfDate;
    const pastDueIncomplete = !!plannedFinish && plannedFinish < asOfDate && progress.status !== "complete";
    // Older items that should already be underway but aren't complete — surfaced in every
    // window so a tight 1-week lookahead never drops a not-started item that's slipping.
    const olderNotComplete = !!plannedStart && plannedStart < asOfDate && progress.status !== "complete";
    if (!alwaysInclude.has(a.canonicalActivityKey) && !(inProgress || startsInWindow || finishesInWindow || spansWindow || pastDueIncomplete || olderNotComplete)) continue;
    rows.push({
      externalUid: a.externalUid,
      canonicalActivityKey: a.canonicalActivityKey,
      wbsCode: a.wbsCode,
      name: a.name,
      type: a.type,
      plannedStart: a.plannedStart,
      plannedFinish: a.plannedFinish,
      progress,
      slippage: computeSlippage(a, progress, asOfDate),
      dueByDataDate: progress.status !== "complete"
        && (inProgress || pastDueIncomplete || (!!plannedStart && plannedStart < dataDayEnd)),
    });
  }
  return rows;
}
