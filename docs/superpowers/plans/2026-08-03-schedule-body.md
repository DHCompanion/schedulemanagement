# Schedule Body Implementation Plan (Redesign Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `ActivityTable` outline with the redesigned schedule body — a desktop timeline drawing planned-vs-expected bars with drift, mobile week-bucket cards, `Full · 6 wk · 3 wk` views, wired drift/at-risk stat links, and week buckets in the OS context packet.

**Architecture:** Two pure libs carry the logic (`weekBuckets` for time-bucketing shared with the OS packet, `timelineGeometry` for date→percent math); a server assembler (`getScheduleData`) builds one `ScheduleRow[]` with forecast fields, collapsing the page's duplicate activity loads; a client component stack (`ScheduleBody` → `TimelineView` desktop / `BucketView` mobile, both opening a shared `ActivityDetail`) replaces `ActivityTable`. Spec: `docs/superpowers/specs/2026-08-03-schedule-ui-redesign-design.md`, Section 3.

**Tech Stack:** Next.js 14 App Router, Tailwind, Vitest (pure + happy-dom component tests), Prisma (assembler + packet only). No new dependencies — bars are positioned `<div>`s, no chart library.

## Global Constraints

- TypeScript strict; never `any`. No `console.log` server-side. No new npm dependencies.
- **One source of numbers:** every expected date / drift figure comes from `computeForecast`/`projectDrift` (`lib/forecast/computeForecast.ts`) via the Task 3 assembler — components never compute drift.
- **Spec §3 rules, verbatim:** WBS section headers keep the existing six-color palette (top-level full-strength, nested lighter); every leaf row carries a thin left rail in its section's color; bars stay semantic — thin grey **planned** bar, solid teal **expected** bar beneath, completed portion darker, red `+Nd` label only when drift > 0; milestones draw a grey outline diamond at the planned position and a solid diamond at the expected position; a **today line** and shaded weekends (windowed views only) sit on the time axis; canonical name first with the MS Project wording muted; existing search/filters (all/milestones/critical/in-progress/not-completed + trade) and sorts (WBS/start/float) carry over, gaining **At risk** filter and **Drift** sort; non-WBS sorts render the flat ungrouped list; start-sort orders by expected start.
- **Buckets** (spec §3): This week / Next week / Weeks 3–6 / Later / Done (Done collapsed by default); bucketing uses **expected** dates; card edge colors red = own drift, amber = pushed by a predecessor, green = on plan; drift in words ("was Aug 7 → now Aug 12"). Weeks start Monday (UTC).
- **Mobile** renders the bucket view instead of the timeline (below Tailwind `md`, 768px).
- **Detail panel** keeps every existing field (ID, % complete, duration, float, discipline, trade partner, procurement tallies + headline, custom fields) and adds planned vs expected date lines, "Pushed by <name> (+Nd)", and the section name.
- **URL params on `/projects/[id]`:** `view=full|6wk|3wk` (default full), `filter=at_risk` (plus existing filter keys), `sort=drift` (plus existing). Stat strip: drift stat links `?sort=drift`, at-risk stat links `?filter=at_risk`.
- **Preserve behavior:** AT RISK pill semantics, ✓ Completed pill, procurement detail lines, milestone marker, critical-red names, collapse/expand of sections with descendant counts, "N activities" count line. The update flow, updates pages, and export flow are untouched.
- **OS packet:** week buckets ride in the packet's free-form `summary` (never `items` — the OS caps items at 25); per-bucket card lists cap at 8 with a warning naming the cap (no silent truncation); existing packet fields and tests stay intact (additive change only).
- Component tests: first line `// @vitest-environment happy-dom`, `@testing-library/react`, `cleanup()` in `afterEach`.
- Commit directly to `master`. `npm run build` and `npm test` before finishing.
- Deliberate deferrals (do NOT build): the progress-capture form restyled as bucket cards (update flow keeps today's form); PDF (phase 4); per-(import,update) caching unless something measures slow.

---

### Task 1: Week buckets (pure lib)

**Files:**
- Create: `lib/schedule/weekBuckets.ts`
- Test: `tests/schedule/weekBuckets.test.ts`

**Interfaces:**
- Consumes: nothing (pure stdlib).
- Produces (BucketView and the OS packet consume exactly these):

```ts
export type BucketKey = "thisWeek" | "nextWeek" | "weeks3to6" | "later" | "done";
export const BUCKET_ORDER: BucketKey[]; // display order, done last
export interface BucketInput {
  status: "not_started" | "in_progress" | "complete";
  expectedStart: string | null;  // ISO
  expectedFinish: string | null;
}
export function mondayOfWeek(d: Date): Date;                 // UTC Monday 00:00 of d's week
export function bucketOf(row: BucketInput, asOf: Date): BucketKey;
export function groupIntoBuckets<T extends BucketInput>(rows: T[], asOf: Date): Record<BucketKey, T[]>;
export function bucketLabel(key: BucketKey, asOf: Date): string; // "This week · Aug 3–9" etc.
export function fmtShortDate(iso: string): string;           // "Aug 7" (UTC)
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/schedule/weekBuckets.test.ts
import { describe, it, expect } from "vitest";
import { mondayOfWeek, bucketOf, groupIntoBuckets, bucketLabel, fmtShortDate, BUCKET_ORDER } from "@/lib/schedule/weekBuckets";

// Mon Aug 3 2026. asOf mid-week Wednesday to prove week alignment.
const asOf = new Date("2026-08-05T12:00:00Z");
const row = (over: Partial<Parameters<typeof bucketOf>[0]> = {}) => ({
  status: "not_started" as const, expectedStart: null, expectedFinish: null, ...over,
});

describe("mondayOfWeek", () => {
  it("maps any weekday to that week's UTC Monday", () => {
    expect(mondayOfWeek(asOf).toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(mondayOfWeek(new Date("2026-08-09T23:00:00Z")).toISOString()).toBe("2026-08-03T00:00:00.000Z"); // Sunday belongs to the Monday-started week
    expect(mondayOfWeek(new Date("2026-08-03T00:00:00Z")).toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });
});

describe("bucketOf", () => {
  it("complete goes to done regardless of dates", () => {
    expect(bucketOf(row({ status: "complete", expectedStart: "2026-09-01T08:00:00Z" }), asOf)).toBe("done");
  });
  it("in progress is always this week — it is active now", () => {
    expect(bucketOf(row({ status: "in_progress", expectedStart: "2026-09-01T08:00:00Z" }), asOf)).toBe("thisWeek");
  });
  it("buckets not-started by expected start against Monday-based weeks", () => {
    expect(bucketOf(row({ expectedStart: "2026-08-07T08:00:00Z" }), asOf)).toBe("thisWeek");   // Fri this week
    expect(bucketOf(row({ expectedStart: "2026-08-10T08:00:00Z" }), asOf)).toBe("nextWeek");   // next Mon
    expect(bucketOf(row({ expectedStart: "2026-08-17T08:00:00Z" }), asOf)).toBe("weeks3to6");  // week 3
    expect(bucketOf(row({ expectedStart: "2026-09-11T08:00:00Z" }), asOf)).toBe("weeks3to6");  // week 6
    expect(bucketOf(row({ expectedStart: "2026-09-14T08:00:00Z" }), asOf)).toBe("later");      // week 7
  });
  it("an overdue not-started activity surfaces in this week", () => {
    expect(bucketOf(row({ expectedStart: "2026-07-20T08:00:00Z" }), asOf)).toBe("thisWeek");
  });
  it("no dates lands in later", () => {
    expect(bucketOf(row(), asOf)).toBe("later");
  });
});

describe("groupIntoBuckets", () => {
  it("returns every bucket key with rows in input order", () => {
    const rows = [
      row({ status: "complete" }),
      row({ expectedStart: "2026-08-06T08:00:00Z" }),
      row({ expectedStart: "2026-08-12T08:00:00Z" }),
    ];
    const g = groupIntoBuckets(rows, asOf);
    expect(Object.keys(g).sort()).toEqual([...BUCKET_ORDER].sort());
    expect(g.done.length).toBe(1);
    expect(g.thisWeek.length).toBe(1);
    expect(g.nextWeek.length).toBe(1);
    expect(g.weeks3to6.length).toBe(0);
  });
});

describe("labels", () => {
  it("renders Monday-Sunday ranges and short dates in UTC", () => {
    expect(bucketLabel("thisWeek", asOf)).toBe("This week · Aug 3–9");
    expect(bucketLabel("nextWeek", asOf)).toBe("Next week · Aug 10–16");
    expect(bucketLabel("weeks3to6", asOf)).toBe("Weeks 3–6 · Aug 17–Sep 13");
    expect(bucketLabel("later", asOf)).toBe("Later");
    expect(bucketLabel("done", asOf)).toBe("Done");
    expect(fmtShortDate("2026-08-07T17:00:00Z")).toBe("Aug 7");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/schedule/weekBuckets.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// lib/schedule/weekBuckets.ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/schedule/weekBuckets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/schedule/weekBuckets.ts tests/schedule/weekBuckets.test.ts
git commit -m "feat(body): week-bucket derivation shared by the mobile view and OS packet"
```

---

### Task 2: Timeline geometry (pure lib)

**Files:**
- Create: `lib/schedule/timelineGeometry.ts`
- Test: `tests/schedule/timelineGeometry.test.ts`

**Interfaces:**
- Consumes: `mondayOfWeek`, `fmtShortDate` from Task 1.
- Produces (TimelineView consumes exactly these):

```ts
export type ViewKey = "full" | "6wk" | "3wk";
export interface TimelineWindow { startMs: number; endMs: number }
export function resolveWindow(view: ViewKey, isoDates: (string | null)[], today: Date): TimelineWindow;
export function spanPct(startIso: string | null, endIso: string | null, win: TimelineWindow): { leftPct: number; widthPct: number } | null;
export function pointPct(iso: string | null, win: TimelineWindow): number | null; // null when outside the window
export function axisTicks(win: TimelineWindow): { leftPct: number; label: string }[]; // weekly Mondays; monthly 1sts when window > 120 days
export function weekendBands(win: TimelineWindow): { leftPct: number; widthPct: number }[]; // empty when window > 120 days
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/schedule/timelineGeometry.test.ts
import { describe, it, expect } from "vitest";
import { resolveWindow, spanPct, pointPct, axisTicks, weekendBands } from "@/lib/schedule/timelineGeometry";

const today = new Date("2026-08-05T12:00:00Z"); // Wed; week starts Mon Aug 3

describe("resolveWindow", () => {
  it("3wk and 6wk start at this week's Monday and span exactly N weeks", () => {
    const w3 = resolveWindow("3wk", [], today);
    expect(new Date(w3.startMs).toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect((w3.endMs - w3.startMs) / 86_400_000).toBe(21);
    const w6 = resolveWindow("6wk", [], today);
    expect((w6.endMs - w6.startMs) / 86_400_000).toBe(42);
  });
  it("full spans min..max of the given dates with padding", () => {
    const w = resolveWindow("full", ["2026-08-03T08:00:00Z", null, "2026-10-30T17:00:00Z"], today);
    expect(w.startMs).toBeLessThan(Date.parse("2026-08-03T08:00:00Z"));
    expect(w.endMs).toBeGreaterThan(Date.parse("2026-10-30T17:00:00Z"));
  });
  it("full with no dates falls back to a four-week window", () => {
    const w = resolveWindow("full", [null], today);
    expect((w.endMs - w.startMs) / 86_400_000).toBe(28);
  });
});

describe("spanPct", () => {
  const win = { startMs: Date.parse("2026-08-03T00:00:00Z"), endMs: Date.parse("2026-08-17T00:00:00Z") }; // 14 days
  it("positions a span as percentages of the window", () => {
    const p = spanPct("2026-08-04T00:00:00Z", "2026-08-11T00:00:00Z", win)!;
    expect(p.leftPct).toBeCloseTo((1 / 14) * 100, 5);
    expect(p.widthPct).toBeCloseTo((7 / 14) * 100, 5);
  });
  it("clamps spans that overflow the window", () => {
    const p = spanPct("2026-07-01T00:00:00Z", "2026-09-01T00:00:00Z", win)!;
    expect(p.leftPct).toBe(0);
    expect(p.widthPct).toBeCloseTo(100, 5);
  });
  it("returns null fully outside and enforces a minimum visible width", () => {
    expect(spanPct("2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z", win)).toBeNull();
    expect(spanPct(null, null, win)).toBeNull();
    const sliver = spanPct("2026-08-04T00:00:00Z", "2026-08-04T00:30:00Z", win)!;
    expect(sliver.widthPct).toBeGreaterThanOrEqual(0.5);
  });
});

describe("pointPct", () => {
  const win = { startMs: Date.parse("2026-08-03T00:00:00Z"), endMs: Date.parse("2026-08-17T00:00:00Z") };
  it("positions a point and nulls outside", () => {
    expect(pointPct("2026-08-10T00:00:00Z", win)).toBeCloseTo(50, 5);
    expect(pointPct("2026-09-01T00:00:00Z", win)).toBeNull();
    expect(pointPct(null, win)).toBeNull();
  });
});

describe("axis", () => {
  it("weekly Monday ticks and weekend bands inside a short window", () => {
    const win = { startMs: Date.parse("2026-08-03T00:00:00Z"), endMs: Date.parse("2026-08-24T00:00:00Z") };
    const ticks = axisTicks(win);
    expect(ticks.map((t) => t.label)).toEqual(["Aug 3", "Aug 10", "Aug 17"]);
    expect(weekendBands(win).length).toBe(3); // one Sat-Sun band per week
  });
  it("switches to monthly ticks and drops weekend bands past 120 days", () => {
    const win = { startMs: Date.parse("2026-01-01T00:00:00Z"), endMs: Date.parse("2026-12-31T00:00:00Z") };
    expect(axisTicks(win).map((t) => t.label)).toContain("Feb 1");
    expect(weekendBands(win)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/schedule/timelineGeometry.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// lib/schedule/timelineGeometry.ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/schedule/timelineGeometry.test.ts tests/schedule/weekBuckets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/schedule/timelineGeometry.ts tests/schedule/timelineGeometry.test.ts
git commit -m "feat(body): pure date-to-percent geometry for the timeline"
```

---

### Task 3: ScheduleRow type + server assembler

**Files:**
- Create: `lib/schedule/types.ts` (types only — zero imports beyond `ActivityProcurement`, safe for client `import type`)
- Create: `lib/schedule/scheduleRows.ts` (server-only assembler)
- Modify: `app/projects/[id]/page.tsx` (swap its inline pipeline for the assembler; still renders `ActivityTable` for now)
- Test: `tests/schedule/scheduleRows.test.ts` (DB-gated)

**Interfaces:**
- Consumes: `computeForecast`, `projectDrift` from `@/lib/forecast/computeForecast`; `baselineProgress`, `ActivityProgress` from `@/lib/lookahead/computeLookahead`; `resolveCurrentProgress` + `getFinalizedEntries`; `getDictionary` + `normalizeName`; `resolveActivityTrades`, `isActivityAtRisk`, `shouldShowProcurementRiskLine` from `@/lib/trades/activityTrades`; `prisma`.
- Produces (every later task and phase 4's PDF read exactly this):

```ts
// lib/schedule/types.ts
import type { ActivityProcurement } from "@/lib/procurement/display";
export type RowStatus = "not_started" | "in_progress" | "complete";
export interface ScheduleRow {
  id: string;
  externalId: number | null;
  wbsCode: string | null;
  name: string;
  canonicalScope: string | null;
  disciplineName: string | null;
  partnerName: string | null;
  atRisk: boolean;
  procurement: ActivityProcurement | null;
  type: string;
  isCritical: boolean;
  outlineLevel: number;
  plannedStart: string | null;
  plannedFinish: string | null;
  expectedStart: string | null;
  expectedFinish: string | null;
  driftDays: number;
  pushedByName: string | null;
  status: RowStatus;
  percentComplete: number | null;
  totalSlackDays: number | null;
  durationDays: number | null;
  customFields: Record<string, string>;
}

// lib/schedule/scheduleRows.ts
export interface ScheduleData {
  rows: ScheduleRow[];
  projectDriftDays: number;
  atRiskCount: number;
  statusDate: string; // ISO — forecast status date (update asOf ?? import statusDate ?? importedAt)
  riskFetchedAt: Date | null;
}
export async function getScheduleData(projectId: string): Promise<ScheduleData | null>; // null = no import
```

`ScheduleRow` is a structural superset of `ActivityTable`'s `ActivityRow`, so the page keeps compiling against `ActivityTable` until Task 7 swaps the body.

- [ ] **Step 1: Write the failing test**

```ts
// tests/schedule/scheduleRows.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getScheduleData } from "@/lib/schedule/scheduleRows";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("getScheduleData", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("returns null with no import and assembles forecast-carrying rows from a pushed chain", async () => {
    const project = await prisma.project.create({ data: { name: "Schedule Rows Test" } });
    projectId = project.id;
    expect(await getScheduleData(project.id)).toBeNull();

    const imp = await prisma.scheduleImport.create({
      data: {
        projectId: project.id, sourceFormat: "msproject_xml", fileName: "f.xml", fileHash: "h",
        statusDate: new Date("2026-08-07T17:00:00Z"), minutesPerDay: 480,
      },
    });
    await prisma.activity.createMany({
      data: [
        {
          scheduleImportId: imp.id, externalUid: 1, canonicalActivityKey: "1|a", name: "Overhead MEP", type: "task",
          wbsCode: "1.1", plannedStart: new Date("2026-08-03T08:00:00Z"), plannedFinish: new Date("2026-08-07T17:00:00Z"),
          durationDays: 5, percentComplete: 20, actualStart: new Date("2026-08-03T08:00:00Z"),
        },
        {
          scheduleImportId: imp.id, externalUid: 2, canonicalActivityKey: "2|b", name: "In-Wall Rough-In", type: "task",
          wbsCode: "1.2", plannedStart: new Date("2026-08-10T08:00:00Z"), plannedFinish: new Date("2026-08-14T17:00:00Z"),
          durationDays: 5,
        },
      ],
    });
    await prisma.relationship.create({
      data: { scheduleImportId: imp.id, predecessorExternalUid: 1, successorExternalUid: 2, type: "FS", lagMinutes: 0 },
    });

    const data = await getScheduleData(project.id);
    expect(data).not.toBeNull();
    const [a, b] = data!.rows;
    expect(a.status).toBe("in_progress");
    expect(a.driftDays).toBe(4);
    expect(b.status).toBe("not_started");
    expect(b.expectedStart!.slice(0, 10)).toBe("2026-08-14");
    expect(b.driftDays).toBe(4);
    expect(b.pushedByName).toBe("Overhead MEP");
    expect(data!.projectDriftDays).toBe(4);
    expect(data!.atRiskCount).toBe(0);
    expect(data!.statusDate.slice(0, 10)).toBe("2026-08-07");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/schedule/scheduleRows.test.ts`
Expected: FAIL (module missing) with `DATABASE_URL` set.

- [ ] **Step 3: Implement**

Create `lib/schedule/types.ts` exactly as in the Interfaces block. Then:

```ts
// lib/schedule/scheduleRows.ts
import { prisma } from "@/lib/db";
import { computeForecast, projectDrift } from "@/lib/forecast/computeForecast";
import { baselineProgress } from "@/lib/lookahead/computeLookahead";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { getDictionary } from "@/lib/normalize/normalizationService";
import { normalizeName } from "@/lib/normalize/normalizeName";
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
  const latestUpdate = await prisma.progressUpdate.findFirst({
    where: { projectId, state: "finalized" },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });
  const statusDate = latestUpdate?.asOfDate ?? latest.statusDate ?? latest.importedAt;

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
      fetchedAt: true,
    },
  });
  const flaggedPartners = new Set(procurementRisk.filter((r) => r.behindCount > 0).map((r) => r.osPartnerId));
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
    return {
      id: a.id,
      externalId: a.externalId,
      wbsCode: a.wbsCode,
      name: a.name,
      canonicalScope: scopeDict.get(normalizeName(a.name)) ?? null,
      disciplineName: trades.get(a.id)?.disciplineName ?? null,
      partnerName: trades.get(a.id)?.partnerName ?? null,
      atRisk: isActivityAtRisk(partnerId, percentComplete, flaggedPartners),
      procurement: partnerId === null ? null : procurementByPartner.get(partnerId) ?? null,
      type: a.type,
      isCritical: a.isCritical,
      outlineLevel: a.outlineLevel,
      plannedStart: a.plannedStart ? a.plannedStart.toISOString() : null,
      plannedFinish: a.plannedFinish ? a.plannedFinish.toISOString() : null,
      expectedStart: f?.expectedStart ? f.expectedStart.toISOString() : null,
      expectedFinish: f?.expectedFinish ? f.expectedFinish.toISOString() : null,
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
```

One subtlety carried over from the old page: the old page took `percentComplete` from the update entry when present, else the import — `progress.percentComplete ?? a.percentComplete` preserves that (for untouched activities `baselineProgress` carries the import's own percent).

- [ ] **Step 4: Swap the page onto the assembler**

In `app/projects/[id]/page.tsx`: delete the inline pipeline (the `latest` query's `include`, `currentProgress`, `scopeDict`, `trades`, `procurementRisk`/`flaggedPartners`/`procurementByPartner`, `riskFetchedAt`, the `rows` construction, the `toDays` helper, `atRiskCount`, and the now-unneeded imports: `resolveCurrentProgress`, `getFinalizedEntries`, `getDictionary`, `normalizeName`, the `@/lib/trades/activityTrades` trio, `getProjectForecast`). Keep `health`, `dataCounts`, `lastFinalized`/`lastUpdate`, tabs/strip/actions JSX. Replace with:

```tsx
  const schedule = await getScheduleData(project.id);
```

(import `getScheduleData` from `@/lib/schedule/scheduleRows`), keep a cheap existence probe for the empty state — replace the old `latest` usages: `{!schedule ? (` for the no-import branch, `schedule.riskFetchedAt` for the freshness line, `<ActivityTable rows={schedule.rows} />` for the body, and the StatStrip becomes:

```tsx
          <StatStrip
            projectId={project.id}
            driftDays={schedule.projectDriftDays}
            atRiskCount={schedule.atRiskCount}
            percentComplete={health.hasImport ? health.progress.percentComplete : 0}
            lastUpdate={lastUpdate}
          />
```

`ScheduleRow` is a structural superset of `ActivityRow`, so `ActivityTable` accepts the rows unchanged.

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/schedule && npm run build && npm test`
Expected: new suite PASS, build clean, full suite green.

- [ ] **Step 6: Commit**

```bash
git add lib/schedule/types.ts lib/schedule/scheduleRows.ts tests/schedule/scheduleRows.test.ts app/projects/[id]/page.tsx
git commit -m "feat(body): single-pass schedule row assembler carrying the forecast layer"
```

---

### Task 4: Section palette + shared ActivityDetail

**Files:**
- Create: `components/sectionPalette.ts`
- Create: `components/ActivityDetail.tsx`
- Test: `tests/components/ActivityDetail.test.tsx`

**Interfaces:**
- Consumes: `ScheduleRow` (type-only) from `@/lib/schedule/types`; `describeProcurement` from `@/lib/procurement/display`; `fmtShortDate` from `@/lib/schedule/weekBuckets`.
- Produces:

```ts
// components/sectionPalette.ts — the existing six colors, plus rail/edge classes
export interface SectionPaletteEntry { bg: string; nestedBg: string; text: string; rail: string }
export const SECTION_PALETTE: SectionPaletteEntry[];
export function paletteEntry(index: number): SectionPaletteEntry;

// components/ActivityDetail.tsx
export function ActivityDetail(props: { row: ScheduleRow; sectionName?: string | null }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/ActivityDetail.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ActivityDetail } from "@/components/ActivityDetail";
import type { ScheduleRow } from "@/lib/schedule/types";

const row = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: "a1", externalId: 101, wbsCode: "1.2", name: "MEP R/I L2", canonicalScope: "Overhead MEP Rough-In",
  disciplineName: "Mechanical", partnerName: "TDIndustries", atRisk: false, procurement: null,
  type: "task", isCritical: false, outlineLevel: 2,
  plannedStart: "2026-08-03T08:00:00.000Z", plannedFinish: "2026-08-07T17:00:00.000Z",
  expectedStart: "2026-08-03T08:00:00.000Z", expectedFinish: "2026-08-12T17:00:00.000Z",
  driftDays: 3, pushedByName: null, status: "in_progress",
  percentComplete: 45, totalSlackDays: 3.5, durationDays: 5, customFields: {},
  ...over,
});

afterEach(() => cleanup());

describe("ActivityDetail", () => {
  it("shows planned vs expected dates with the drift delta", () => {
    render(<ActivityDetail row={row()} />);
    expect(screen.getByText(/Planned: Aug 3 → Aug 7/)).toBeTruthy();
    expect(screen.getByText(/Expected: Aug 3 → Aug 12/)).toBeTruthy();
    expect(screen.getByText("+3d")).toBeTruthy();
  });
  it("names the pushing predecessor when there is one", () => {
    render(<ActivityDetail row={row({ pushedByName: "Overhead MEP Rough-In", driftDays: 4 })} />);
    expect(screen.getByText(/Pushed by Overhead MEP Rough-In \(\+4d\)/)).toBeTruthy();
  });
  it("keeps the existing fields and shows the section name when given", () => {
    render(<ActivityDetail row={row()} sectionName="Level 2 Rough-In" />);
    expect(screen.getByText(/ID: 101/)).toBeTruthy();
    expect(screen.getByText(/% complete: 45/)).toBeTruthy();
    expect(screen.getByText(/Total float \(days\): 3.50/)).toBeTruthy();
    expect(screen.getByText(/Discipline: Mechanical/)).toBeTruthy();
    expect(screen.getByText(/Section: Level 2 Rough-In/)).toBeTruthy();
  });
  it("renders procurement tallies when present", () => {
    render(<ActivityDetail row={row({ procurement: { itemCount: 9, behindCount: 3, submittalLateCount: 2, projectedLateCount: 1, releasedAtRiskCount: 0, missingDatesCount: 0 } })} />);
    expect(screen.getByText(/This trade's procurement:/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/ActivityDetail.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

```ts
// components/sectionPalette.ts
// The six-color WBS section identity system carried over from the old body —
// the owner was explicit that section colors stay. Bars keep semantic colors;
// this palette only ever touches section headers, row rails, and card edges.
export interface SectionPaletteEntry {
  bg: string;
  nestedBg: string;
  text: string;
  rail: string;
}

export const SECTION_PALETTE: SectionPaletteEntry[] = [
  { bg: "bg-indigo-100", nestedBg: "bg-indigo-50", text: "text-indigo-900", rail: "border-indigo-400" },
  { bg: "bg-amber-100", nestedBg: "bg-amber-50", text: "text-amber-900", rail: "border-amber-400" },
  { bg: "bg-emerald-100", nestedBg: "bg-emerald-50", text: "text-emerald-900", rail: "border-emerald-400" },
  { bg: "bg-rose-100", nestedBg: "bg-rose-50", text: "text-rose-900", rail: "border-rose-400" },
  { bg: "bg-sky-100", nestedBg: "bg-sky-50", text: "text-sky-900", rail: "border-sky-400" },
  { bg: "bg-violet-100", nestedBg: "bg-violet-50", text: "text-violet-900", rail: "border-violet-400" },
];

export function paletteEntry(index: number): SectionPaletteEntry {
  return SECTION_PALETTE[index % SECTION_PALETTE.length];
}
```

```tsx
// components/ActivityDetail.tsx
"use client";

import type { ScheduleRow } from "@/lib/schedule/types";
import { describeProcurement } from "@/lib/procurement/display";
import { fmtShortDate } from "@/lib/schedule/weekBuckets";

function range(startIso: string | null, endIso: string | null): string {
  const s = startIso ? fmtShortDate(startIso) : "—";
  const e = endIso ? fmtShortDate(endIso) : "—";
  return `${s} → ${e}`;
}

/** The row detail panel shared by the timeline and bucket views (spec §3). */
export function ActivityDetail({ row, sectionName }: { row: ScheduleRow; sectionName?: string | null }) {
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
      <div className="col-span-2 flex flex-wrap gap-x-4">
        <span>Planned: {range(row.plannedStart, row.plannedFinish)}</span>
        <span>
          Expected: {range(row.expectedStart, row.expectedFinish)}
          {row.driftDays > 0 && <span className="ml-1 font-semibold text-red-600">+{row.driftDays}d</span>}
        </span>
      </div>
      {row.pushedByName && (
        <div className="col-span-2 text-amber-800">
          Pushed by {row.pushedByName} (+{row.driftDays}d)
        </div>
      )}
      <div>ID: {row.externalId ?? "—"}</div>
      <div>% complete: {row.percentComplete ?? "—"}</div>
      <div>Duration (days): {row.durationDays?.toFixed(2) ?? "—"}</div>
      <div>Total float (days): {row.totalSlackDays?.toFixed(2) ?? "—"}</div>
      {row.disciplineName && <div>Discipline: {row.disciplineName}</div>}
      {row.partnerName && <div>Trade partner: {row.partnerName}</div>}
      {sectionName && <div className="col-span-2">Section: {sectionName}</div>}
      {row.procurement && (() => {
        const { headline, details } = describeProcurement(row.procurement);
        return (
          <div className="col-span-2">
            <div>This trade&apos;s procurement: {headline}</div>
            {details.map((d) => (
              <div key={d} className="pl-3 text-slate-500">{d}</div>
            ))}
          </div>
        );
      })()}
      {Object.entries(row.customFields).map(([k, v]) => (
        <div key={k}>{k}: {v}</div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/components/ActivityDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/sectionPalette.ts components/ActivityDetail.tsx tests/components/ActivityDetail.test.tsx
git commit -m "feat(body): shared section palette and forecast-aware detail panel"
```

---

### Task 5: TimelineView (desktop body)

**Files:**
- Create: `components/TimelineView.tsx`
- Test: `tests/components/TimelineView.test.tsx`

**Interfaces:**
- Consumes: `ScheduleRow` (type), `TimelineWindow`/`spanPct`/`pointPct`/`axisTicks`/`weekendBands` from Task 2, `paletteEntry` from Task 4, `ActivityDetail`.
- Produces (ScheduleBody in Task 7 renders exactly this):

```tsx
export interface TimelineItem {
  row: ScheduleRow;
  paletteIndex: number;     // section color cycle position (summaries and their leaves share it)
  descendantCount: number;  // visible leaves under a summary
  sectionName: string | null; // nearest summary ancestor's name, for leaves
}
export function TimelineView(props: {
  items: TimelineItem[];          // pre-filtered/ordered by ScheduleBody; summaries included when grouped
  window: TimelineWindow;
  todayIso: string;               // status date — the today line
  openId: string | null;
  onToggleOpen(id: string): void;
  collapsed: Set<string>;         // summary ids; TimelineView only renders what it is given — collapse filtering happens upstream
  onToggleCollapsed(id: string): void;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/TimelineView.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { TimelineView, type TimelineItem } from "@/components/TimelineView";
import type { ScheduleRow } from "@/lib/schedule/types";

const win = { startMs: Date.parse("2026-08-03T00:00:00Z"), endMs: Date.parse("2026-08-31T00:00:00Z") };

const base = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: "a1", externalId: 1, wbsCode: "1.1", name: "MEP R/I L2", canonicalScope: "Overhead MEP Rough-In",
  disciplineName: "Mechanical", partnerName: "TDI", atRisk: false, procurement: null,
  type: "task", isCritical: false, outlineLevel: 2,
  plannedStart: "2026-08-03T08:00:00.000Z", plannedFinish: "2026-08-07T17:00:00.000Z",
  expectedStart: "2026-08-03T08:00:00.000Z", expectedFinish: "2026-08-12T17:00:00.000Z",
  driftDays: 3, pushedByName: null, status: "in_progress",
  percentComplete: 45, totalSlackDays: null, durationDays: 5, customFields: {},
  ...over,
});
const item = (row: ScheduleRow, over: Partial<TimelineItem> = {}): TimelineItem =>
  ({ row, paletteIndex: 0, descendantCount: 0, sectionName: "Rough-In", ...over });

const noop = () => {};

afterEach(() => cleanup());

describe("TimelineView", () => {
  it("renders planned and expected bars with a red drift label", () => {
    const { container } = render(
      <TimelineView items={[item(base())]} window={win} todayIso="2026-08-05T00:00:00.000Z" openId={null} onToggleOpen={noop} collapsed={new Set()} onToggleCollapsed={noop} />,
    );
    expect(container.querySelector('[data-bar="planned"]')).toBeTruthy();
    expect(container.querySelector('[data-bar="expected"]')).toBeTruthy();
    expect(screen.getByText("+3d").className).toContain("text-red-600");
  });
  it("prefers the canonical name and keeps the raw name muted; AT RISK pill carries over", () => {
    render(
      <TimelineView items={[item(base({ atRisk: true }))]} window={win} todayIso="2026-08-05T00:00:00.000Z" openId={null} onToggleOpen={noop} collapsed={new Set()} onToggleCollapsed={noop} />,
    );
    expect(screen.getByText("Overhead MEP Rough-In")).toBeTruthy();
    expect(screen.getByText("MEP R/I L2")).toBeTruthy();
    expect(screen.getByText("AT RISK")).toBeTruthy();
  });
  it("draws milestones as diamonds, not bars", () => {
    const ms = base({ id: "m1", type: "milestone", durationDays: 0, plannedFinish: "2026-08-03T08:00:00.000Z", expectedFinish: "2026-08-03T08:00:00.000Z", driftDays: 0 });
    const { container } = render(
      <TimelineView items={[item(ms)]} window={win} todayIso="2026-08-05T00:00:00.000Z" openId={null} onToggleOpen={noop} collapsed={new Set()} onToggleCollapsed={noop} />,
    );
    expect(container.querySelector('[data-bar]')).toBeNull();
    expect(container.querySelector('[data-milestone]')).toBeTruthy();
  });
  it("summary rows show the palette header with count and fire collapse", () => {
    const summary = base({ id: "s1", type: "summary", outlineLevel: 1, name: "Level 2 Rough-In", canonicalScope: null });
    let toggled = "";
    render(
      <TimelineView items={[item(summary, { descendantCount: 7 })]} window={win} todayIso="2026-08-05T00:00:00.000Z" openId={null} onToggleOpen={noop} collapsed={new Set()} onToggleCollapsed={(id) => { toggled = id; }} />,
    );
    expect(screen.getByText(/7 activities/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Level 2 Rough-In/));
    expect(toggled).toBe("s1");
  });
  it("clicking a leaf opens the shared detail panel", () => {
    let opened = "";
    render(
      <TimelineView items={[item(base())]} window={win} todayIso="2026-08-05T00:00:00.000Z" openId={null} onToggleOpen={(id) => { opened = id; }} collapsed={new Set()} onToggleCollapsed={noop} />,
    );
    fireEvent.click(screen.getByText("Overhead MEP Rough-In"));
    expect(opened).toBe("a1");
  });
  it("shows the detail with section name when openId matches", () => {
    render(
      <TimelineView items={[item(base())]} window={win} todayIso="2026-08-05T00:00:00.000Z" openId="a1" onToggleOpen={noop} collapsed={new Set()} onToggleCollapsed={noop} />,
    );
    expect(screen.getByText(/Section: Rough-In/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/TimelineView.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```tsx
// components/TimelineView.tsx
"use client";

import type { ScheduleRow } from "@/lib/schedule/types";
import { spanPct, pointPct, axisTicks, weekendBands, type TimelineWindow } from "@/lib/schedule/timelineGeometry";
import { paletteEntry } from "./sectionPalette";
import { ActivityDetail } from "./ActivityDetail";

export interface TimelineItem {
  row: ScheduleRow;
  paletteIndex: number;
  descendantCount: number;
  sectionName: string | null;
}

const LEFT_COL = "38%";

export function TimelineView({
  items,
  window: win,
  todayIso,
  openId,
  onToggleOpen,
  collapsed,
  onToggleCollapsed,
}: {
  items: TimelineItem[];
  window: TimelineWindow;
  todayIso: string;
  openId: string | null;
  onToggleOpen(id: string): void;
  collapsed: Set<string>;
  onToggleCollapsed(id: string): void;
}) {
  const ticks = axisTicks(win);
  const bands = weekendBands(win);
  const todayPct = pointPct(todayIso, win);

  return (
    <div className="relative overflow-hidden rounded border border-slate-200 bg-white">
      {/* Time layers: weekend bands + today line span the bar area of every row. */}
      <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: LEFT_COL }}>
        {bands.map((b, i) => (
          <div key={i} className="absolute inset-y-0 bg-slate-100/70" style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }} />
        ))}
        {todayPct !== null && (
          <div className="absolute inset-y-0 z-10 w-px bg-cyan-600" style={{ left: `${todayPct}%` }} />
        )}
      </div>

      {/* Axis header */}
      <div className="relative flex border-b-2 border-slate-200 text-[10px] text-slate-500">
        <div className="shrink-0 px-3 py-1 font-medium" style={{ width: LEFT_COL }}>Activity</div>
        <div className="relative h-6 flex-1">
          {ticks.map((t) => (
            <span key={t.label + t.leftPct} className="absolute top-1 -translate-x-1/2 whitespace-nowrap" style={{ left: `${t.leftPct}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-slate-100">
        {items.map(({ row: a, paletteIndex, descendantCount, sectionName }) => {
          if (a.type === "summary") {
            const palette = paletteEntry(paletteIndex);
            const isCollapsed = collapsed.has(a.id);
            return (
              <li key={a.id} className={`relative ${a.outlineLevel === 1 ? palette.bg : palette.nestedBg}`}>
                <button
                  onClick={() => onToggleCollapsed(a.id)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm font-semibold ${palette.text}`}
                  style={{ paddingLeft: 10 + (a.outlineLevel - 1) * 12 }}
                >
                  <span>
                    {isCollapsed ? "▸" : "▾"} <span className="mr-2 text-xs font-normal opacity-70">{a.wbsCode}</span>
                    <span>{a.name}</span>
                  </span>
                  <span className="whitespace-nowrap text-xs font-normal opacity-70">
                    {descendantCount} activities{isCollapsed ? " (collapsed)" : ""}
                  </span>
                </button>
              </li>
            );
          }

          const palette = paletteEntry(paletteIndex);
          const isMilestone = a.type === "milestone";
          const planned = isMilestone ? null : spanPct(a.plannedStart, a.plannedFinish, win);
          const expected = isMilestone ? null : spanPct(a.expectedStart ?? a.plannedStart, a.expectedFinish ?? a.plannedFinish, win);
          const plannedPoint = isMilestone ? pointPct(a.plannedFinish ?? a.plannedStart, win) : null;
          const expectedPoint = isMilestone ? pointPct(a.expectedFinish ?? a.expectedStart ?? a.plannedFinish, win) : null;
          const pct = Math.min(100, Math.max(0, a.percentComplete ?? 0));

          return (
            <li key={a.id} className="relative">
              <div className="flex items-stretch">
                <button
                  onClick={() => onToggleOpen(a.id)}
                  className={`shrink-0 border-l-4 px-3 py-1.5 text-left text-sm ${palette.rail}`}
                  style={{ width: LEFT_COL, paddingLeft: 10 + (a.outlineLevel - 1) * 12 }}
                >
                  <span className="mr-2 text-xs text-slate-400">{a.wbsCode}</span>
                  <span className={a.isCritical ? "font-medium text-red-700" : "font-medium"}>{a.canonicalScope ?? a.name}</span>
                  {a.canonicalScope && a.canonicalScope !== a.name && (
                    <span className="ml-2 text-xs text-slate-400">{a.name}</span>
                  )}
                  {isMilestone && <span className="ml-2 text-xs text-indigo-600">◆</span>}
                  {a.percentComplete === 100 && (
                    <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">✓ Completed</span>
                  )}
                  {a.atRisk && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">AT RISK</span>
                  )}
                </button>
                <div className="relative min-h-[2.25rem] flex-1">
                  {planned && (
                    <div
                      data-bar="planned"
                      className="absolute top-2 h-1.5 rounded-sm bg-slate-300"
                      style={{ left: `${planned.leftPct}%`, width: `${planned.widthPct}%` }}
                    />
                  )}
                  {expected && (
                    <div
                      data-bar="expected"
                      className="absolute top-4 h-2.5 overflow-hidden rounded-sm bg-cyan-600/70"
                      style={{ left: `${expected.leftPct}%`, width: `${expected.widthPct}%` }}
                    >
                      <div className="h-full bg-cyan-800" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {expected && a.driftDays > 0 && (
                    <span
                      className="absolute top-3.5 ml-1 text-[10px] font-bold text-red-600"
                      style={{ left: `${Math.min(expected.leftPct + expected.widthPct, 97)}%` }}
                    >
                      +{a.driftDays}d
                    </span>
                  )}
                  {plannedPoint !== null && (
                    <span data-milestone="planned" className="absolute top-2 -translate-x-1/2 text-xs text-slate-400" style={{ left: `${plannedPoint}%` }}>◇</span>
                  )}
                  {expectedPoint !== null && (
                    <span data-milestone="expected" className="absolute top-2 -translate-x-1/2 text-xs text-indigo-600" style={{ left: `${expectedPoint}%` }}>◆</span>
                  )}
                </div>
              </div>
              {openId === a.id && (
                <div className="px-3 pb-2" style={{ paddingLeft: 14 + (a.outlineLevel - 1) * 12 }}>
                  <ActivityDetail row={a} sectionName={sectionName} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/components/TimelineView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/TimelineView.tsx tests/components/TimelineView.test.tsx
git commit -m "feat(body): desktop timeline with planned/expected bars and drift labels"
```

---

### Task 6: BucketView (mobile body)

**Files:**
- Create: `components/BucketView.tsx`
- Test: `tests/components/BucketView.test.tsx`

**Interfaces:**
- Consumes: `ScheduleRow` (type); `groupIntoBuckets`, `bucketLabel`, `fmtShortDate`, `BUCKET_ORDER` from Task 1; `paletteEntry` from Task 4; `ActivityDetail`.
- Produces (ScheduleBody renders exactly this):

```tsx
export interface BucketRow extends ScheduleRow { paletteIndex: number; sectionName: string | null }
export function BucketView(props: {
  rows: BucketRow[];          // leaves only, pre-filtered by ScheduleBody
  asOfIso: string;            // status date
  openId: string | null;
  onToggleOpen(id: string): void;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/BucketView.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { BucketView, type BucketRow } from "@/components/BucketView";
import type { ScheduleRow } from "@/lib/schedule/types";

const asOf = "2026-08-05T12:00:00.000Z"; // Wed; week = Aug 3–9

const base = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: "a1", externalId: 1, wbsCode: "1.1", name: "MEP R/I L2", canonicalScope: "Overhead MEP Rough-In",
  disciplineName: "Mechanical", partnerName: "TDIndustries", atRisk: false, procurement: null,
  type: "task", isCritical: false, outlineLevel: 2,
  plannedStart: "2026-08-03T08:00:00.000Z", plannedFinish: "2026-08-07T17:00:00.000Z",
  expectedStart: "2026-08-03T08:00:00.000Z", expectedFinish: "2026-08-07T17:00:00.000Z",
  driftDays: 0, pushedByName: null, status: "in_progress",
  percentComplete: 45, totalSlackDays: null, durationDays: 5, customFields: {},
  ...over,
});
const brow = (over: Partial<ScheduleRow> = {}, palette = 0): BucketRow =>
  ({ ...base(over), paletteIndex: palette, sectionName: "Rough-In" });

afterEach(() => cleanup());

describe("BucketView", () => {
  it("groups cards under labeled week buckets by expected dates", () => {
    render(
      <BucketView
        rows={[brow(), brow({ id: "a2", name: "Cable Tray", canonicalScope: null, status: "not_started", expectedStart: "2026-08-12T08:00:00.000Z" })]}
        asOfIso={asOf} openId={null} onToggleOpen={() => {}}
      />,
    );
    expect(screen.getByText("This week · Aug 3–9")).toBeTruthy();
    expect(screen.getByText("Next week · Aug 10–16")).toBeTruthy();
    expect(screen.getByText("Cable Tray")).toBeTruthy();
  });
  it("writes drift in words on a pushed card", () => {
    render(
      <BucketView
        rows={[brow({ status: "not_started", plannedStart: "2026-08-07T08:00:00.000Z", plannedFinish: "2026-08-11T17:00:00.000Z", expectedStart: "2026-08-12T08:00:00.000Z", expectedFinish: "2026-08-14T17:00:00.000Z", driftDays: 3, pushedByName: "Overhead MEP" })]}
        asOfIso={asOf} openId={null} onToggleOpen={() => {}}
      />,
    );
    expect(screen.getByText(/was Aug 7 → now Aug 12/)).toBeTruthy();
  });
  it("hides done inside a collapsed details element", () => {
    const { container } = render(
      <BucketView rows={[brow({ status: "complete", percentComplete: 100 })]} asOfIso={asOf} openId={null} onToggleOpen={() => {}} />,
    );
    const done = container.querySelector("details");
    expect(done).toBeTruthy();
    expect(done!.hasAttribute("open")).toBe(false);
  });
  it("empty buckets render nothing (no empty headings)", () => {
    render(<BucketView rows={[brow()]} asOfIso={asOf} openId={null} onToggleOpen={() => {}} />);
    expect(screen.queryByText(/Weeks 3–6/)).toBeNull();
  });
  it("tapping a card opens the shared detail", () => {
    let opened = "";
    render(<BucketView rows={[brow()]} asOfIso={asOf} openId={null} onToggleOpen={(id) => { opened = id; }} />);
    fireEvent.click(screen.getByText("Overhead MEP Rough-In"));
    expect(opened).toBe("a1");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/BucketView.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```tsx
// components/BucketView.tsx
"use client";

import type { ScheduleRow } from "@/lib/schedule/types";
import { groupIntoBuckets, bucketLabel, fmtShortDate, BUCKET_ORDER, type BucketKey } from "@/lib/schedule/weekBuckets";
import { paletteEntry } from "./sectionPalette";
import { ActivityDetail } from "./ActivityDetail";

export interface BucketRow extends ScheduleRow {
  paletteIndex: number;
  sectionName: string | null;
}

// Card status edge (spec §3): red = its own slip, amber = pushed by a
// predecessor, green = on plan.
function edgeClass(row: ScheduleRow): string {
  if (row.driftDays > 0 && !row.pushedByName) return "border-l-red-600";
  if (row.driftDays > 0) return "border-l-amber-500";
  return "border-l-emerald-500";
}

function driftWords(row: ScheduleRow): string | null {
  if (row.driftDays <= 0) return null;
  if (row.status === "not_started" && row.plannedStart && row.expectedStart) {
    return `was ${fmtShortDate(row.plannedStart)} → now ${fmtShortDate(row.expectedStart)}`;
  }
  if (row.plannedFinish && row.expectedFinish) {
    return `was ${fmtShortDate(row.plannedFinish)} → now ${fmtShortDate(row.expectedFinish)}`;
  }
  return `+${row.driftDays}d`;
}

function Card({ row, openId, onToggleOpen }: { row: BucketRow; openId: string | null; onToggleOpen(id: string): void }) {
  const words = driftWords(row);
  return (
    <div className={`mb-2 rounded border border-slate-200 border-l-4 bg-white ${edgeClass(row)}`}>
      <button onClick={() => onToggleOpen(row.id)} className="w-full px-3 py-2 text-left">
        <div className="flex items-start justify-between gap-2">
          <span className={`text-sm font-medium ${row.isCritical ? "text-red-700" : "text-slate-900"}`}>
            {row.type === "milestone" && <span className="mr-1 text-indigo-600">◆</span>}
            {row.canonicalScope ?? row.name}
          </span>
          {words ? (
            <span className="whitespace-nowrap text-xs font-semibold text-amber-700">{words}</span>
          ) : (
            <span className="whitespace-nowrap text-xs font-semibold text-emerald-600">on plan</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className={`inline-block h-2 w-2 rounded-sm border-l-0 ${paletteEntry(row.paletteIndex).bg}`} />
          {row.disciplineName && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5">
              {row.disciplineName}
              {row.partnerName ? ` · ${row.partnerName}` : ""}
            </span>
          )}
          {row.percentComplete !== null && row.percentComplete > 0 && <span>{row.percentComplete}% done</span>}
          {row.atRisk && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">AT RISK</span>
          )}
        </div>
      </button>
      {openId === row.id && (
        <div className="px-3 pb-2">
          <ActivityDetail row={row} sectionName={row.sectionName} />
        </div>
      )}
    </div>
  );
}

export function BucketView({
  rows,
  asOfIso,
  openId,
  onToggleOpen,
}: {
  rows: BucketRow[];
  asOfIso: string;
  openId: string | null;
  onToggleOpen(id: string): void;
}) {
  const asOf = new Date(asOfIso);
  const buckets = groupIntoBuckets(rows, asOf);

  return (
    <div>
      {BUCKET_ORDER.filter((k): k is Exclude<BucketKey, "done"> => k !== "done").map((key) =>
        buckets[key].length === 0 ? null : (
          <section key={key} className="mb-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-cyan-800">{bucketLabel(key, asOf)}</h3>
            {buckets[key].map((row) => (
              <Card key={row.id} row={row} openId={openId} onToggleOpen={onToggleOpen} />
            ))}
          </section>
        ),
      )}
      {buckets.done.length > 0 && (
        <details className="mb-4">
          <summary className="mb-2 cursor-pointer text-xs font-bold uppercase tracking-wide text-slate-500">
            Done · {buckets.done.length}
          </summary>
          {buckets.done.map((row) => (
            <Card key={row.id} row={row} openId={openId} onToggleOpen={onToggleOpen} />
          ))}
        </details>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/components/BucketView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/BucketView.tsx tests/components/BucketView.test.tsx
git commit -m "feat(body): mobile week-bucket cards with drift in words"
```

---

### Task 7: ScheduleBody + page integration + ActivityTable retirement

**Files:**
- Create: `components/ScheduleBody.tsx`
- Modify: `app/projects/[id]/page.tsx` (searchParams + swap `ActivityTable` → `ScheduleBody`)
- Modify: `components/StatStrip.tsx` (drift + at-risk stats become links)
- Modify: `tests/components/ShellComponents.test.tsx` (assert the new links)
- Delete: `components/ActivityTable.tsx`, `tests/components/ActivityTable.test.tsx`
- Test: `tests/components/ScheduleBody.test.tsx`

**Interfaces:**
- Consumes: everything above. `ScheduleBody` owns all client state (search, filter, discipline, sort, collapse, open row, viewport) and the grouped-outline pipeline formerly in `ActivityTable` (`deriveSectionInfo`/`isHiddenByCollapse`/`assignSiblingIndices` from `@/lib/schedule/wbsGrouping` — unchanged lib).
- Produces:

```tsx
export function ScheduleBody(props: {
  rows: ScheduleRow[];
  projectId: string;
  statusDate: string;                       // ISO — today line + bucket asOf
  view: "full" | "6wk" | "3wk";
  initialFilter: string | null;             // validated inside
  initialSort: string | null;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/ScheduleBody.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { ScheduleBody } from "@/components/ScheduleBody";
import type { ScheduleRow } from "@/lib/schedule/types";

const mk = (over: Partial<ScheduleRow>): ScheduleRow => ({
  id: "x", externalId: 1, wbsCode: "1", name: "n", canonicalScope: null,
  disciplineName: null, partnerName: null, atRisk: false, procurement: null,
  type: "task", isCritical: false, outlineLevel: 1,
  plannedStart: "2026-08-03T08:00:00.000Z", plannedFinish: "2026-08-07T17:00:00.000Z",
  expectedStart: "2026-08-03T08:00:00.000Z", expectedFinish: "2026-08-07T17:00:00.000Z",
  driftDays: 0, pushedByName: null, status: "not_started",
  percentComplete: 0, totalSlackDays: null, durationDays: 5, customFields: {},
  ...over,
});

const rows: ScheduleRow[] = [
  mk({ id: "s1", type: "summary", name: "Rough-In", outlineLevel: 1 }),
  mk({ id: "a1", name: "Overhead MEP", outlineLevel: 2, wbsCode: "1.1", driftDays: 3, atRisk: true, disciplineName: "Mechanical" }),
  mk({ id: "a2", name: "Paint", outlineLevel: 2, wbsCode: "1.2", disciplineName: "Finishes" }),
];

afterEach(() => cleanup());

describe("ScheduleBody", () => {
  it("renders the grouped timeline with section header and activity count", () => {
    render(<ScheduleBody rows={rows} projectId="p1" statusDate="2026-08-05T00:00:00.000Z" view="full" initialFilter={null} initialSort={null} />);
    expect(screen.getByText("Rough-In")).toBeTruthy();
    expect(screen.getByText("2 activities")).toBeTruthy();
  });
  it("filters to at-risk from the initialFilter URL param", () => {
    render(<ScheduleBody rows={rows} projectId="p1" statusDate="2026-08-05T00:00:00.000Z" view="full" initialFilter="at_risk" initialSort={null} />);
    expect(screen.getByText("Overhead MEP")).toBeTruthy();
    expect(screen.queryByText("Paint")).toBeNull();
  });
  it("drift sort renders the flat list with the biggest slip first", () => {
    render(<ScheduleBody rows={rows} projectId="p1" statusDate="2026-08-05T00:00:00.000Z" view="full" initialFilter={null} initialSort="drift" />);
    const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names.findIndex((t) => t.includes("Overhead MEP"))).toBeLessThan(names.findIndex((t) => t.includes("Paint")));
    expect(screen.queryByText("Rough-In")).toBeNull(); // no section headers when flat
  });
  it("search narrows by name", () => {
    render(<ScheduleBody rows={rows} projectId="p1" statusDate="2026-08-05T00:00:00.000Z" view="full" initialFilter={null} initialSort={null} />);
    fireEvent.change(screen.getByPlaceholderText("Search name / WBS / ID"), { target: { value: "paint" } });
    expect(screen.queryByText("Overhead MEP")).toBeNull();
    expect(screen.getByText("Paint")).toBeTruthy();
  });
  it("view switcher links carry the view param", () => {
    render(<ScheduleBody rows={rows} projectId="p1" statusDate="2026-08-05T00:00:00.000Z" view="6wk" initialFilter={null} initialSort={null} />);
    expect(screen.getByText("3 wk").closest("a")!.getAttribute("href")).toBe("/projects/p1?view=3wk");
    expect(screen.getByText("Full").closest("a")!.getAttribute("href")).toBe("/projects/p1?view=full");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/ScheduleBody.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement ScheduleBody**

```tsx
// components/ScheduleBody.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ScheduleRow } from "@/lib/schedule/types";
import { deriveSectionInfo, isHiddenByCollapse, assignSiblingIndices } from "@/lib/schedule/wbsGrouping";
import { resolveWindow, type ViewKey } from "@/lib/schedule/timelineGeometry";
import { TimelineView, type TimelineItem } from "./TimelineView";
import { BucketView, type BucketRow } from "./BucketView";

type Filter = "all" | "milestones" | "critical" | "in_progress" | "not_completed" | "at_risk";
type Sort = "wbs" | "start" | "slack" | "drift";

const FILTERS: Filter[] = ["all", "milestones", "critical", "in_progress", "not_completed", "at_risk"];
const SORTS: Sort[] = ["wbs", "start", "slack", "drift"];
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "full", label: "Full" },
  { key: "6wk", label: "6 wk" },
  { key: "3wk", label: "3 wk" },
];

function leafMatches(a: ScheduleRow, q: string, filter: Filter, discipline: string): boolean {
  if (q.trim()) {
    const needle = q.trim().toLowerCase();
    const hit =
      a.name.toLowerCase().includes(needle) ||
      (a.canonicalScope ?? "").toLowerCase().includes(needle) ||
      (a.disciplineName ?? "").toLowerCase().includes(needle) ||
      (a.partnerName ?? "").toLowerCase().includes(needle) ||
      (a.wbsCode ?? "").includes(needle) ||
      String(a.externalId ?? "").includes(needle);
    if (!hit) return false;
  }
  if (filter === "milestones" && a.type !== "milestone") return false;
  if (filter === "critical" && !a.isCritical) return false;
  if (filter === "in_progress" && !((a.percentComplete ?? 0) > 0 && (a.percentComplete ?? 0) < 100)) return false;
  if (filter === "not_completed" && a.percentComplete === 100) return false;
  if (filter === "at_risk" && !a.atRisk) return false;
  if (discipline !== "all" && a.disciplineName !== discipline) return false;
  return true;
}

function useIsDesktop(): boolean {
  // SSR renders desktop; phones correct on hydration (spec: mobile = buckets).
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return isDesktop;
}

export function ScheduleBody({
  rows,
  projectId,
  statusDate,
  view,
  initialFilter,
  initialSort,
}: {
  rows: ScheduleRow[];
  projectId: string;
  statusDate: string;
  view: ViewKey;
  initialFilter: string | null;
  initialSort: string | null;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(FILTERS.includes(initialFilter as Filter) ? (initialFilter as Filter) : "all");
  const [discipline, setDiscipline] = useState("all");
  const [sort, setSort] = useState<Sort>(SORTS.includes(initialSort as Sort) ? (initialSort as Sort) : "wbs");
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const isDesktop = useIsDesktop();

  const grouped = sort === "wbs";

  const disciplines = useMemo(
    () => [...new Set(rows.map((r) => r.disciplineName).filter((d): d is string => Boolean(d)))].sort(),
    [rows],
  );

  const window = useMemo(() => {
    const dates = rows.flatMap((r) => [r.plannedStart, r.plannedFinish, r.expectedStart, r.expectedFinish]);
    return resolveWindow(view, dates, new Date(statusDate));
  }, [rows, view, statusDate]);

  // In windowed views only work touching the window (or active work) shows.
  const inWindow = useMemo(() => {
    if (view === "full") return () => true;
    return (a: ScheduleRow) => {
      if (a.status === "in_progress") return true;
      const s = Date.parse(a.expectedStart ?? a.plannedStart ?? "");
      const e = Date.parse(a.expectedFinish ?? a.plannedFinish ?? "");
      if (Number.isNaN(s) && Number.isNaN(e)) return false;
      const from = Number.isNaN(s) ? e : s;
      const to = Number.isNaN(e) ? s : e;
      return to >= window.startMs && from <= window.endMs;
    };
  }, [view, window]);

  const sortedRows = useMemo(() => {
    const r = [...rows];
    if (sort === "wbs") r.sort((a, b) => (a.wbsCode ?? "").localeCompare(b.wbsCode ?? "", undefined, { numeric: true }));
    if (sort === "start") r.sort((a, b) => (a.expectedStart ?? a.plannedStart ?? "").localeCompare(b.expectedStart ?? b.plannedStart ?? ""));
    if (sort === "slack") r.sort((a, b) => (a.totalSlackDays ?? Infinity) - (b.totalSlackDays ?? Infinity));
    if (sort === "drift") r.sort((a, b) => b.driftDays - a.driftDays);
    return r;
  }, [rows, sort]);

  // Grouped outline pipeline (ported from the retired ActivityTable), extended
  // with the nearest-section name/palette each leaf carries for rails and cards.
  const { items, leafCount } = useMemo(() => {
    const candidates = sortedRows.filter((a) => a.type !== "project_summary");
    const info = deriveSectionInfo(candidates.map((a) => ({ id: a.id, outlineLevel: a.outlineLevel })));
    const byId = new Map(candidates.map((a) => [a.id, a]));
    const matchedLeafIds = new Set(
      candidates
        .filter((a) => a.type !== "summary" && leafMatches(a, q, filter, discipline) && inWindow(a))
        .map((a) => a.id),
    );

    if (!grouped) {
      const flat: TimelineItem[] = [];
      for (const a of sortedRows) {
        if (a.type === "summary" || a.type === "project_summary" || !matchedLeafIds.has(a.id)) continue;
        const summaryAncestor = [...(info.get(a.id)?.ancestorIds ?? [])].reverse().find((id) => byId.get(id)?.type === "summary");
        flat.push({ row: a, paletteIndex: 0, descendantCount: 0, sectionName: summaryAncestor ? byId.get(summaryAncestor)!.name : null });
      }
      return { items: flat, leafCount: flat.length };
    }

    const hasVisibleDescendant = new Set<string>();
    const descendantCounts = new Map<string, number>();
    for (const a of candidates) {
      if (!matchedLeafIds.has(a.id)) continue;
      for (const ancestorId of info.get(a.id)?.ancestorIds ?? []) {
        hasVisibleDescendant.add(ancestorId);
        descendantCounts.set(ancestorId, (descendantCounts.get(ancestorId) ?? 0) + 1);
      }
    }
    const visibleSections = candidates.filter((a) => a.type === "summary" && hasVisibleDescendant.has(a.id));
    const siblingIndex = assignSiblingIndices(visibleSections, info);

    const result: TimelineItem[] = [];
    for (const a of candidates) {
      const isLeaf = a.type !== "summary";
      const included = isLeaf ? matchedLeafIds.has(a.id) : hasVisibleDescendant.has(a.id);
      if (!included) continue;
      const rowInfo = info.get(a.id)!;
      if (isHiddenByCollapse(rowInfo.ancestorIds, collapsed)) continue;
      const summaryAncestorId = [...rowInfo.ancestorIds].reverse().find((id) => byId.get(id)?.type === "summary") ?? null;
      result.push({
        row: a,
        paletteIndex: isLeaf
          ? (summaryAncestorId ? siblingIndex.get(summaryAncestorId) ?? 0 : 0)
          : siblingIndex.get(a.id) ?? 0,
        descendantCount: descendantCounts.get(a.id) ?? 0,
        sectionName: summaryAncestorId ? byId.get(summaryAncestorId)!.name : null,
      });
    }
    return { items: result, leafCount: matchedLeafIds.size };
  }, [grouped, sortedRows, q, filter, discipline, collapsed, inWindow]);

  const bucketRows: BucketRow[] = useMemo(
    () =>
      items
        .filter((i) => i.row.type !== "summary")
        .map((i) => ({ ...i.row, paletteIndex: i.paletteIndex, sectionName: i.sectionName })),
    [items],
  );

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / WBS / ID"
          className="min-w-[12rem] flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded border border-slate-300 px-2 py-2 text-sm">
          <option value="all">All</option>
          <option value="milestones">Milestones</option>
          <option value="critical">Critical</option>
          <option value="in_progress">In progress</option>
          <option value="not_completed">Not completed</option>
          <option value="at_risk">At risk</option>
        </select>
        {disciplines.length > 0 && (
          <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm">
            <option value="all">All trades</option>
            {disciplines.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded border border-slate-300 px-2 py-2 text-sm">
          <option value="wbs">Sort: WBS</option>
          <option value="start">Sort: Start</option>
          <option value="slack">Sort: Float</option>
          <option value="drift">Sort: Drift</option>
        </select>
        {isDesktop && (
          <span className="ml-auto flex overflow-hidden rounded border border-slate-300 text-sm">
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={`/projects/${projectId}?view=${v.key}`}
                className={`px-3 py-2 ${view === v.key ? "bg-cyan-700 font-medium text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {v.label}
              </Link>
            ))}
          </span>
        )}
      </div>
      <p className="mb-2 text-xs text-slate-500">{leafCount} activities</p>
      {isDesktop ? (
        <TimelineView
          items={items}
          window={window}
          todayIso={statusDate}
          openId={openId}
          onToggleOpen={(id) => setOpenId(openId === id ? null : id)}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      ) : (
        <BucketView
          rows={bucketRows}
          asOfIso={statusDate}
          openId={openId}
          onToggleOpen={(id) => setOpenId(openId === id ? null : id)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Page integration, stat links, ActivityTable retirement**

In `app/projects/[id]/page.tsx`:
- Props become `{ params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; filter?: string; sort?: string }> }`; `const searchParams = await props.searchParams;`.
- Replace the `ActivityTable` import with `import { ScheduleBody } from "@/components/ScheduleBody";` (and drop the now-unused `ActivityRow` type import if present).
- Replace `<ActivityTable rows={schedule.rows} />` with:

```tsx
          <ScheduleBody
            rows={schedule.rows}
            projectId={project.id}
            statusDate={schedule.statusDate}
            view={searchParams.view === "6wk" || searchParams.view === "3wk" ? searchParams.view : "full"}
            initialFilter={searchParams.filter ?? null}
            initialSort={searchParams.sort ?? null}
          />
```

In `components/StatStrip.tsx`: the drift and at-risk stat boxes become `Link`s (same inner markup):

```tsx
      <Link href={`/projects/${projectId}?sort=drift`} className={`${box} border-slate-200 bg-white hover:bg-slate-50`}>
        <div className={`text-xl font-bold ${driftDays > 0 ? "text-red-600" : "text-slate-900"}`}>
          {driftDays > 0 ? `+${driftDays}d` : "on plan"}
        </div>
        <div className="text-xs text-slate-500">projected drift</div>
      </Link>
      <Link href={`/projects/${projectId}?filter=at_risk`} className={`${box} border-slate-200 bg-white hover:bg-slate-50`}>
        <div className={`text-xl font-bold ${atRiskCount > 0 ? "text-amber-700" : "text-slate-900"}`}>{atRiskCount}</div>
        <div className="text-xs text-slate-500">at risk</div>
      </Link>
```

Also update the phase-2 comment above the component ("Drift and at-risk are plain stats for now…") — it is no longer true; replace with `// Every stat links into the body: drift sorts by slip, at-risk filters to flagged.`

In `tests/components/ShellComponents.test.tsx`, extend the first StatStrip test with:

```tsx
    expect(screen.getByText("+3d").closest("a")!.getAttribute("href")).toBe("/projects/p1?sort=drift");
    expect(screen.getByText("4").closest("a")!.getAttribute("href")).toBe("/projects/p1?filter=at_risk");
```

Then retire the old body:

```bash
rm components/ActivityTable.tsx tests/components/ActivityTable.test.tsx
```

Confirm nothing references it: `grep -rn "ActivityTable" app components tests lib` must return nothing. (Its behaviors have homes: AT RISK pill + canonical-name display → TimelineView tests; collapse + counts → TimelineView/ScheduleBody tests; filters/search → ScheduleBody tests; detail fields → ActivityDetail tests.)

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/components tests/schedule && npm run build && npm test`
Expected: all green, build clean.

- [ ] **Step 6: Commit**

```bash
git add -A components tests/components app/projects/[id]/page.tsx
git commit -m "feat(body): responsive schedule body replaces the outline table"
```

---

### Task 8: Week buckets in the OS context packet

**Files:**
- Modify: `lib/os-context/scheduleContextPacket.ts`
- Modify/extend: the existing packet test in `tests/os-context/` (read the directory first; extend the existing suite file following its patterns)

**Interfaces:**
- Consumes: `computeForecast` from `@/lib/forecast/computeForecast`; `baselineProgress` from `@/lib/lookahead/computeLookahead`; `resolveCurrentProgress` + `getFinalizedEntries`; `groupIntoBuckets`, `BUCKET_ORDER`, type `BucketKey` from Task 1.
- Produces: `summary.weekBuckets` on the packet —

```ts
type WeekBucketCard = {
  name: string;
  partnerName: string | null;
  driftDays: number;
  expectedStart: string | null;
  expectedFinish: string | null;
  percentComplete: number | null;
};
// summary.weekBuckets: Record<BucketKey, { count: number; cards: WeekBucketCard[] }>
// cards capped at 8 per bucket (done always []); truncation named in warnings.
```

- [ ] **Step 1: Write the failing test (append inside the existing `describe.runIf(hasDb)` block of `tests/os-context/scheduleContextPacket.test.ts`)**

The suite's `seedProject` helper wires trades and a single activity — this test needs a chain instead, so it seeds directly (same pattern as `tests/schedule/scheduleRows.test.ts`), reusing the suite's `stamp` and `createdProjectIds` for uniqueness and cleanup. No trade wiring: bucket cards carry `partnerName: null` then, which is exactly what an unassigned schedule produces.

```ts
  it("summarizes week buckets from the forecast layer", async () => {
    const osProjectId = 810000 + (stamp % 1000);
    const project = await prisma.project.create({
      data: { name: `os-context buckets ${osProjectId}`, osProjectId },
    });
    createdProjectIds.push(project.id);
    const imp = await prisma.scheduleImport.create({
      data: {
        projectId: project.id, sourceFormat: "msproject_xml", fileName: "s.xml", fileHash: `hb-${project.id}`,
        statusDate: new Date("2026-08-07T17:00:00Z"), minutesPerDay: 480,
      },
    });
    // Same chain fixture as tests/schedule/scheduleRows.test.ts: A 20% in
    // progress at the Aug 7 status date (+4d), B FS-pushed to Fri Aug 14.
    await prisma.activity.createMany({
      data: [
        {
          scheduleImportId: imp.id, externalUid: 1, canonicalActivityKey: `1|zzbucket-a-${stamp}`, name: "A", type: "task",
          plannedStart: new Date("2026-08-03T08:00:00Z"), plannedFinish: new Date("2026-08-07T17:00:00Z"),
          durationDays: 5, percentComplete: 20, actualStart: new Date("2026-08-03T08:00:00Z"),
        },
        {
          scheduleImportId: imp.id, externalUid: 2, canonicalActivityKey: `2|zzbucket-b-${stamp}`, name: "B", type: "task",
          plannedStart: new Date("2026-08-10T08:00:00Z"), plannedFinish: new Date("2026-08-14T17:00:00Z"),
          durationDays: 5,
        },
      ],
    });
    await prisma.relationship.create({
      data: { scheduleImportId: imp.id, predecessorExternalUid: 1, successorExternalUid: 2, type: "FS", lagMinutes: 0 },
    });

    const packet = await buildScheduleContextPacket(osProjectId, 25);
    const wb = packet.summary.weekBuckets as Record<
      string,
      { count: number; cards: { name: string; driftDays: number; partnerName: string | null }[] }
    >;
    expect(wb.thisWeek.count).toBe(1); // A is in progress -> this week
    expect(wb.thisWeek.cards[0].name).toBe("A");
    expect(wb.thisWeek.cards[0].driftDays).toBe(4);
    // asOf Fri Aug 7 -> week0 = Mon Aug 3; B's expected start Fri Aug 14 lands in week0+1.
    expect(wb.nextWeek.count).toBe(1);
    expect(wb.nextWeek.cards[0].name).toBe("B");
    expect(wb.nextWeek.cards[0].partnerName).toBeNull();
    expect(wb.done).toEqual({ count: 0, cards: [] });
  });
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `npx vitest run tests/os-context/scheduleContextPacket.test.ts` — the new test FAILS (`weekBuckets` undefined). Then in `lib/os-context/scheduleContextPacket.ts`:

- Add imports: `computeForecast` from `@/lib/forecast/computeForecast`; `baselineProgress` from `@/lib/lookahead/computeLookahead`; `resolveCurrentProgress` from `@/lib/lookahead/currentProgress`; `getFinalizedEntries` from `@/lib/updates/updateService`; `groupIntoBuckets`, `BUCKET_ORDER`, type `BucketKey` from `@/lib/schedule/weekBuckets`.
- Change the `latestImport` query's include to `{ activities: true, relationships: true }`.
- After the existing `leaves` line, add:

```ts
  const progressByKey = resolveCurrentProgress(await getFinalizedEntries(project.id));
  const dataDate = latestImport.statusDate ?? latestImport.importedAt;
  const forecasts = computeForecast({
    activities: latestImport.activities,
    relationships: latestImport.relationships,
    progressByKey,
    statusDate: dataDate,
    minutesPerDay: latestImport.minutesPerDay,
  });
```

- Build the bucket summary after the existing `items` construction (partner name via the same `tradeDictionary` + `assignments` the packet already loaded; scope comes from the packet's existing `mapped` result — build `const scopeByActivityId = new Map(mapped.map((m) => [m.activity.id, m.canonicalScope]));` right after the `applyDictionary` destructure):

```ts
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
  );
```

- Add `weekBuckets` to the returned `summary` object, and after the existing warnings pushes:

```ts
  if (bucketsTruncated) {
    warnings.push(`Week buckets list up to ${CARD_CAP} activities each; counts cover all.`);
  }
```

- The `dataDate` const replaces the inline `latestImport.statusDate ?? latestImport.importedAt` in the existing summary's `dataDate` field (same value, computed once).

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/os-context && npm run build && npm test`
Expected: extended suite green (existing packet assertions untouched — the change is additive), build clean, full suite green.

- [ ] **Step 4: Commit**

```bash
git add lib/os-context/scheduleContextPacket.ts tests/os-context
git commit -m "feat(os-context): week buckets in the schedule packet summary for Connect's week view"
```

---

## Not in this phase (deliberate)

- Progress-capture form restyled as bucket cards (spec §3 mentions it; the update flow keeps today's form — candidate phase 3.5, needs its own pass over the update entry mechanics).
- Lookahead PDF and the `/lookahead` route — phase 4 (it will consume `getScheduleData` + `groupIntoBuckets`/`timelineGeometry` from this phase).
- Summary rows draw no bars (headers only); roll-up bars are a possible later polish.
- View-switcher links carry only `view` (current filter/sort state resets on view change) — acceptable v1.
- No virtualization; if thousand-row timelines scroll poorly, that's a measured follow-up.
