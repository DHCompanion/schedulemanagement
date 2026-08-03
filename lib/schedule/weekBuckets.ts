const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export type BucketKey = "thisWeek" | "nextWeek" | "weeks3to6" | "later" | "done";
export const BUCKET_ORDER: BucketKey[] = ["thisWeek", "nextWeek", "weeks3to6", "later", "done"];

export interface BucketInput {
  status: "not_started" | "in_progress" | "complete";
  expectedStart: string | null;
  expectedFinish: string | null;
}

/** UTC Monday 00:00 of the week containing d (Sunday belongs to the preceding Monday's week). */
export function mondayOfWeek(d: Date): Date {
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - diff * DAY_MS);
}

export function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Buckets tell the field what's ACTUALLY coming (spec §3): expected dates,
 * not planned. In-progress work is active now, so it is always this week;
 * an overdue not-started activity also surfaces in this week rather than
 * disappearing into the past.
 */
export function bucketOf(row: BucketInput, asOf: Date): BucketKey {
  if (row.status === "complete") return "done";
  if (row.status === "in_progress") return "thisWeek";
  if (!row.expectedStart) return "later";
  const t = Date.parse(row.expectedStart);
  const week0 = mondayOfWeek(asOf).getTime();
  if (t < week0 + WEEK_MS) return "thisWeek";
  if (t < week0 + 2 * WEEK_MS) return "nextWeek";
  if (t < week0 + 6 * WEEK_MS) return "weeks3to6";
  return "later";
}

export function groupIntoBuckets<T extends BucketInput>(rows: T[], asOf: Date): Record<BucketKey, T[]> {
  const out: Record<BucketKey, T[]> = { thisWeek: [], nextWeek: [], weeks3to6: [], later: [], done: [] };
  for (const r of rows) out[bucketOf(r, asOf)].push(r);
  return out;
}

export function bucketLabel(key: BucketKey, asOf: Date): string {
  const week0 = mondayOfWeek(asOf).getTime();
  const range = (startMs: number, endMs: number) => {
    const s = new Date(startMs);
    const e = new Date(endMs);
    const sameMonth = s.getUTCMonth() === e.getUTCMonth();
    const sTxt = fmtShortDate(s.toISOString());
    const eTxt = sameMonth ? String(e.getUTCDate()) : fmtShortDate(e.toISOString());
    return `${sTxt}–${eTxt}`;
  };
  switch (key) {
    case "thisWeek":
      return `This week · ${range(week0, week0 + 6 * DAY_MS)}`;
    case "nextWeek":
      return `Next week · ${range(week0 + WEEK_MS, week0 + WEEK_MS + 6 * DAY_MS)}`;
    case "weeks3to6":
      return `Weeks 3–6 · ${range(week0 + 2 * WEEK_MS, week0 + 6 * WEEK_MS - DAY_MS)}`;
    case "later":
      return "Later";
    case "done":
      return "Done";
  }
}
