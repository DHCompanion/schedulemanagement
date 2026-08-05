import { resolveWindow, spanPct, pointPct, axisTicks, weekendBands } from "@/lib/schedule/timelineGeometry";
import type { ScheduleRow } from "@/lib/schedule/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNASSIGNED = "Unassigned";

export type LookaheadWeeks = 3 | 6;
export interface TradeColor {
  bg: string;
  text: string;
}
export interface LookaheadStats {
  driftDays: number;
  atRiskCount: number;
  percentComplete: number;
  startingCount: number;
}
export interface LookaheadGridRow {
  id: string;
  name: string;
  secondaryName: string | null;
  driftDays: number;
  percentComplete: number;
  isMilestone: boolean;
  isCritical: boolean;
  atRisk: boolean;
  bar: { leftPct: number; widthPct: number } | null;
  /** Planned finish tick, drawn only when it differs from the expected finish. */
  ghostPct: number | null;
  expectedPointPct: number | null;
  plannedPointPct: number | null;
}
export interface LookaheadBand {
  trade: string;
  partners: string[];
  color: TradeColor;
  rows: LookaheadGridRow[];
}
export interface LookaheadMilestone {
  name: string;
  planned: string | null;
  expected: string | null;
  driftDays: number;
  beyondWindow: boolean;
}
export interface LookaheadView {
  title: string;
  windowLabel: string;
  statusDateLabel: string;
  generatedLabel: string;
  stats: LookaheadStats;
  attention: string[];
  milestones: LookaheadMilestone[];
  bands: LookaheadBand[];
  ticks: { leftPct: number; label: string }[];
  weekends: { leftPct: number; widthPct: number }[];
  todayPct: number | null;
}

// Print-safe pairs: light fill, dark ink — legible in greyscale too.
const TRADE_COLORS: TradeColor[] = [
  { bg: "#e0e7ff", text: "#312e81" },
  { bg: "#fef3c7", text: "#78350f" },
  { bg: "#d1fae5", text: "#064e3b" },
  { bg: "#ffe4e6", text: "#881337" },
  { bg: "#e0f2fe", text: "#0c4a6e" },
  { bg: "#ede9fe", text: "#4c1d95" },
  { bg: "#fce7f3", text: "#831843" },
  { bg: "#ecfccb", text: "#365314" },
];
const NEUTRAL: TradeColor = { bg: "#f1f5f9", text: "#334155" };

/** Same trade = same color everywhere, so the band a superintendent learns on one sheet holds on the next. */
export function tradeColor(trade: string): TradeColor {
  if (trade === UNASSIGNED) return NEUTRAL;
  let h = 0;
  for (let i = 0; i < trade.length; i++) h = (h * 31 + trade.charCodeAt(i)) >>> 0;
  return TRADE_COLORS[h % TRADE_COLORS.length];
}

function fmtDay(iso: string | number): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function fmtFull(iso: string | number): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function displayName(r: ScheduleRow): string {
  return r.canonicalScope ?? r.name;
}

/** "Aug 3–23, 2026" inside one month, "Aug 3–Sep 13, 2026" across two — same shape as bucketLabel. */
function framedLabel(startMs: number, lastMs: number): string {
  const s = new Date(startMs);
  const e = new Date(lastMs);
  const sameMonth = s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth();
  return `${fmtDay(startMs)}–${sameMonth ? e.getUTCDate() : fmtDay(lastMs)}, ${e.getUTCFullYear()}`;
}

export function buildLookaheadView(input: {
  rows: ScheduleRow[];
  projectDriftDays: number;
  statusDate: string;
  percentComplete: number;
  lastUpdateDaysAgo: number | null;
  weeks: LookaheadWeeks;
  today: Date;
}): LookaheadView {
  const { rows, weeks, today } = input;
  const win = resolveWindow(weeks === 6 ? "6wk" : "3wk", [], today);

  const inWindow: { row: ScheduleRow; grid: LookaheadGridRow }[] = [];
  for (const r of rows) {
    if (r.type === "summary") continue;
    const isMilestone = r.type === "milestone";
    const expectedPointPct = isMilestone ? pointPct(r.expectedFinish ?? r.expectedStart, win) : null;
    const bar = isMilestone ? null : spanPct(r.expectedStart, r.expectedFinish, win);
    if (!bar && expectedPointPct === null) continue;
    const finishDiffers = r.plannedFinish !== null && r.plannedFinish !== r.expectedFinish;
    inWindow.push({
      row: r,
      grid: {
        id: r.id,
        name: displayName(r),
        secondaryName: r.canonicalScope && r.canonicalScope !== r.name ? r.name : null,
        driftDays: r.driftDays,
        percentComplete: Math.min(100, Math.max(0, r.percentComplete ?? 0)),
        isMilestone,
        isCritical: r.isCritical,
        atRisk: r.atRisk,
        bar,
        ghostPct: !isMilestone && finishDiffers ? pointPct(r.plannedFinish, win) : null,
        expectedPointPct,
        plannedPointPct: isMilestone ? pointPct(r.plannedFinish ?? r.plannedStart, win) : null,
      },
    });
  }

  const byTrade = new Map<string, { partners: Set<string>; entries: typeof inWindow }>();
  for (const entry of inWindow) {
    const trade = entry.row.disciplineName ?? UNASSIGNED;
    const band = byTrade.get(trade) ?? { partners: new Set<string>(), entries: [] };
    if (entry.row.partnerName) band.partners.add(entry.row.partnerName);
    band.entries.push(entry);
    byTrade.set(trade, band);
  }
  const bands: LookaheadBand[] = [...byTrade.entries()]
    .sort((a, b) => (a[0] === UNASSIGNED ? 1 : b[0] === UNASSIGNED ? -1 : a[0].localeCompare(b[0])))
    .map(([trade, band]) => ({
      trade,
      partners: [...band.partners].sort(),
      color: tradeColor(trade),
      rows: band.entries
        .sort((a, b) => (a.row.expectedStart ?? "").localeCompare(b.row.expectedStart ?? ""))
        .map((e) => e.grid),
    }));

  // "Starting this window" is work that has not begun — in-progress activities
  // started before the window opened, however their dates fall.
  const startsInWindow = (r: ScheduleRow) => {
    if (r.status !== "not_started" || !r.expectedStart) return false;
    const t = Date.parse(r.expectedStart);
    return t >= win.startMs && t < win.endMs;
  };

  const milestones: LookaheadMilestone[] = rows
    .filter((r) => r.type === "milestone")
    .map((r) => ({
      name: displayName(r),
      planned: r.plannedFinish ?? r.plannedStart,
      expected: r.expectedFinish ?? r.expectedStart,
      driftDays: r.driftDays,
      beyondWindow: Date.parse(r.expectedFinish ?? r.expectedStart ?? "") >= win.endMs,
    }))
    .filter((m) => m.expected !== null && Date.parse(m.expected) >= win.startMs)
    .sort((a, b) => (a.expected ?? "").localeCompare(b.expected ?? ""));
  const firstBeyond = milestones.findIndex((m) => m.beyondWindow);

  return {
    title: `${weeks}-Week Lookahead`,
    windowLabel: framedLabel(win.startMs, win.endMs - DAY_MS),
    statusDateLabel: fmtFull(input.statusDate),
    generatedLabel: fmtFull(today.toISOString()),
    stats: {
      driftDays: input.projectDriftDays,
      atRiskCount: inWindow.filter((e) => e.row.atRisk).length,
      percentComplete: input.percentComplete,
      startingCount: inWindow.filter((e) => startsInWindow(e.row)).length,
    },
    attention: attentionSentences(
      inWindow.map((e) => e.row),
      input.lastUpdateDaysAgo,
    ),
    milestones: firstBeyond === -1 ? milestones : milestones.slice(0, firstBeyond + 3),
    bands,
    ticks: axisTicks(win),
    weekends: weekendBands(win),
    todayPct: pointPct(today.toISOString(), win),
  };
}

/**
 * The meeting talks in sentences, not tallies (spec §4). Procurement first
 * (someone else must act), then what slipped and why, then the warning that the
 * numbers themselves may be old.
 */
function attentionSentences(rows: ScheduleRow[], lastUpdateDaysAgo: number | null): string[] {
  const out: string[] = [];

  const byPartner = new Map<string, { behind: number; names: string[] }>();
  for (const r of rows) {
    if (!r.atRisk || !r.partnerName || !r.procurement) continue;
    const e = byPartner.get(r.partnerName) ?? { behind: r.procurement.behindCount, names: [] };
    e.names.push(displayName(r));
    byPartner.set(r.partnerName, e);
  }
  for (const [partner, e] of [...byPartner.entries()].sort((a, b) => b[1].behind - a[1].behind)) {
    const shown = e.names.slice(0, 3).join(", ");
    const rest = e.names.length > 3 ? ` +${e.names.length - 3} more` : "";
    out.push(`${partner} behind on ${e.behind} items — ${shown}${rest} at risk.`);
  }

  const drifting = rows.filter((r) => r.driftDays > 0).sort((a, b) => b.driftDays - a.driftDays).slice(0, 3);
  for (const r of drifting) {
    out.push(
      r.pushedByName
        ? `${displayName(r)} pushed +${r.driftDays}d by ${r.pushedByName}.`
        : `${displayName(r)} is running +${r.driftDays}d late.`,
    );
  }

  if (lastUpdateDaysAgo === null) out.push("No progress update recorded yet — dates are the imported plan.");
  else if (lastUpdateDaysAgo > 7) out.push(`No progress update in ${lastUpdateDaysAgo} days — figures may be stale.`);

  return out.length > 0 ? out : ["Nothing flagged — in-window work is on plan."];
}
