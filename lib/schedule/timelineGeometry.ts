import { mondayOfWeek } from "./weekBuckets";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DETAIL_MAX_DAYS = 120; // beyond this, weekly ticks and weekend bands are visual noise

export type ViewKey = "full" | "6wk" | "3wk";
export interface TimelineWindow {
  startMs: number;
  endMs: number;
}

export function resolveWindow(view: ViewKey, isoDates: (string | null)[], today: Date): TimelineWindow {
  if (view !== "full") {
    const weeks = view === "6wk" ? 6 : 3;
    const startMs = mondayOfWeek(today).getTime();
    return { startMs, endMs: startMs + weeks * WEEK_MS };
  }
  const ts = isoDates.filter((d): d is string => d !== null).map((d) => Date.parse(d));
  if (ts.length === 0) {
    const startMs = mondayOfWeek(today).getTime();
    return { startMs, endMs: startMs + 4 * WEEK_MS };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const t of ts) {
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const pad = Math.max(DAY_MS, Math.round((max - min) * 0.02));
  return { startMs: min - pad, endMs: max + pad };
}

export function spanPct(
  startIso: string | null,
  endIso: string | null,
  win: TimelineWindow,
): { leftPct: number; widthPct: number } | null {
  if (!startIso && !endIso) return null;
  const s = Date.parse(startIso ?? endIso!);
  const e = Math.max(Date.parse(endIso ?? startIso!), s);
  if (e <= win.startMs || s >= win.endMs) return null;
  const total = win.endMs - win.startMs;
  const cs = Math.max(s, win.startMs);
  const ce = Math.min(e, win.endMs);
  return {
    leftPct: ((cs - win.startMs) / total) * 100,
    widthPct: Math.max(((ce - cs) / total) * 100, 0.5),
  };
}

export function pointPct(iso: string | null, win: TimelineWindow): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (t < win.startMs || t > win.endMs) return null;
  return ((t - win.startMs) / (win.endMs - win.startMs)) * 100;
}

const DAILY_MAX_DAYS = 45; // beyond this, per-day labels and gridlines are noise

function mmdd(t: number): string {
  const d = new Date(t);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * Axis labels, all m/d. Windowed views label the days themselves (every day
 * up to ~3.5 weeks, every other day up to 45 days), centered over the day
 * cell; longer spans fall back to weekly Mondays, then monthly 1sts.
 */
export function axisTicks(win: TimelineWindow): { leftPct: number; label: string }[] {
  const total = win.endMs - win.startMs;
  const days = total / DAY_MS;
  const ticks: { leftPct: number; label: string }[] = [];
  if (days <= DAILY_MAX_DAYS) {
    const step = days <= 24 ? 1 : 2;
    const d = new Date(win.startMs);
    let cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (cursor < win.startMs) cursor += DAY_MS;
    while (cursor < win.endMs) {
      const center = cursor + DAY_MS / 2;
      if (center < win.endMs) {
        ticks.push({ leftPct: ((center - win.startMs) / total) * 100, label: mmdd(cursor) });
      }
      cursor += step * DAY_MS;
    }
    return ticks;
  }
  if (days > DETAIL_MAX_DAYS) {
    // Monthly: the 1st of each month inside the window.
    const d = new Date(win.startMs);
    let cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    while (cursor < win.endMs) {
      ticks.push({ leftPct: ((cursor - win.startMs) / total) * 100, label: mmdd(cursor) });
      const c = new Date(cursor);
      cursor = Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1);
    }
    return ticks;
  }
  let cursor = mondayOfWeek(new Date(win.startMs)).getTime();
  if (cursor < win.startMs) cursor += WEEK_MS;
  while (cursor < win.endMs) {
    ticks.push({ leftPct: ((cursor - win.startMs) / total) * 100, label: mmdd(cursor) });
    cursor += WEEK_MS;
  }
  return ticks;
}

/**
 * Vertical gridline positions: one per UTC midnight when the window is 45
 * days or tighter (Mondays major), else the weekly/monthly tick positions.
 */
export function gridLines(win: TimelineWindow): { leftPct: number; isMajor: boolean }[] {
  const total = win.endMs - win.startMs;
  if (total / DAY_MS > DAILY_MAX_DAYS) {
    return axisTicks(win).map((t) => ({ leftPct: t.leftPct, isMajor: true }));
  }
  const lines: { leftPct: number; isMajor: boolean }[] = [];
  const d = new Date(win.startMs);
  let cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (cursor <= win.startMs) cursor += DAY_MS;
  while (cursor < win.endMs) {
    lines.push({ leftPct: ((cursor - win.startMs) / total) * 100, isMajor: new Date(cursor).getUTCDay() === 1 });
    cursor += DAY_MS;
  }
  return lines;
}

export function weekendBands(win: TimelineWindow): { leftPct: number; widthPct: number }[] {
  const total = win.endMs - win.startMs;
  if (total / DAY_MS > DETAIL_MAX_DAYS) return [];
  const bands: { leftPct: number; widthPct: number }[] = [];
  // First Saturday 00:00 at or before the window start, then every week.
  let cursor = mondayOfWeek(new Date(win.startMs)).getTime() + 5 * DAY_MS;
  if (cursor + 2 * DAY_MS <= win.startMs) cursor += WEEK_MS;
  while (cursor < win.endMs) {
    const s = Math.max(cursor, win.startMs);
    const e = Math.min(cursor + 2 * DAY_MS, win.endMs);
    if (e > s) bands.push({ leftPct: ((s - win.startMs) / total) * 100, widthPct: ((e - s) / total) * 100 });
    cursor += WEEK_MS;
  }
  return bands;
}
