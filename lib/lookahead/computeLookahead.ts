export type ProgressStatus = "not_started" | "in_progress" | "complete";
export type SlippageFlag = "overdue" | "should-have-started" | "on-track";

export interface ActivityProgress {
  status: ProgressStatus;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number | null;
  note: string | null;
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
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function defaultProgress(): ActivityProgress {
  return { status: "not_started", actualStart: null, actualFinish: null, percentComplete: null, note: null };
}

export function computeSlippage(a: LookaheadActivity, p: ActivityProgress, asOfDate: Date): SlippageFlag {
  if (a.plannedFinish && a.plannedFinish < asOfDate && p.status !== "complete") return "overdue";
  if (a.plannedStart && a.plannedStart < asOfDate && p.status === "not_started") return "should-have-started";
  return "on-track";
}

export function computeLookahead(
  activities: LookaheadActivity[],
  progressByKey: Map<string, ActivityProgress>,
  asOfDate: Date,
  weeks: number,
): LookaheadRow[] {
  const windowEnd = new Date(asOfDate.getTime() + weeks * WEEK_MS);
  const rows: LookaheadRow[] = [];
  for (const a of activities) {
    if (a.type === "summary" || a.type === "project_summary") continue;
    if (!a.isActive) continue;
    const progress = progressByKey.get(a.canonicalActivityKey) ?? defaultProgress();
    const inProgress = progress.status === "in_progress" || (!!progress.actualStart && !progress.actualFinish);
    const startsInWindow = !!a.plannedStart && a.plannedStart >= asOfDate && a.plannedStart <= windowEnd;
    const finishesInWindow = !!a.plannedFinish && a.plannedFinish >= asOfDate && a.plannedFinish <= windowEnd;
    const spansWindow = !!a.plannedStart && !!a.plannedFinish && a.plannedStart <= asOfDate && a.plannedFinish >= asOfDate;
    const pastDueIncomplete = !!a.plannedFinish && a.plannedFinish < asOfDate && progress.status !== "complete";
    if (!(inProgress || startsInWindow || finishesInWindow || spansWindow || pastDueIncomplete)) continue;
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
    });
  }
  return rows;
}
