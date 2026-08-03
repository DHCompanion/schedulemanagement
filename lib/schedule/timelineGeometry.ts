import { mondayOfWeek, fmtShortDate } from "./weekBuckets";

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

export function axisTicks(win: TimelineWindow): { leftPct: number; label: string }[] {
  const total = win.endMs - win.startMs;
  const ticks: { leftPct: number; label: string }[] = [];
  if (total / DAY_MS > DETAIL_MAX_DAYS) {
    // Monthly: the 1st of each month inside the window.
    const d = new Date(win.startMs);
    let cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    while (cursor < win.endMs) {
      ticks.push({ leftPct: ((cursor - win.startMs) / total) * 100, label: fmtShortDate(new Date(cursor).toISOString()) });
      const c = new Date(cursor);
      cursor = Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1);
    }
    return ticks;
  }
  let cursor = mondayOfWeek(new Date(win.startMs)).getTime();
  if (cursor < win.startMs) cursor += WEEK_MS;
  while (cursor < win.endMs) {
    ticks.push({ leftPct: ((cursor - win.startMs) / total) * 100, label: fmtShortDate(new Date(cursor).toISOString()) });
    cursor += WEEK_MS;
  }
  return ticks;
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
