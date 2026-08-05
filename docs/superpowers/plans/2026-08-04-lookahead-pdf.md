# Lookahead View + Meeting PDF Implementation Plan (Redesign Phase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/projects/[id]/lookahead?weeks=3|6&size=tabloid|letter` — a branded summary page plus a trade-banded bar grid that reads as a screen view and prints as the meeting PDF — and a `/api/export/lookahead-pdf` endpoint that streams the exact same sheet as a downloaded PDF.

**Architecture:** A pure builder (`buildLookaheadView`) turns the phase-3 `ScheduleData` into a fully-positioned view model (bars already in percent, via `timelineGeometry`); one presentational component (`LookaheadSheet`) renders it; one CSS string (`lookaheadCss(size)`) styles it including `@page`. Because the sheet is a plain synchronous component with self-contained CSS, the PDF endpoint renders the identical tree with `renderToStaticMarkup` and hands the resulting standalone HTML to headless Chromium via `setContent` — no self-fetch, no cookie forwarding, no asset URLs, and screen and paper cannot drift.

**Tech Stack:** Next.js 15 App Router, React 19, Vitest (pure + happy-dom component tests), Prisma (assembler only), and two new production dependencies for the PDF endpoint only: `playwright-core` + `@sparticuz/chromium`. This route deliberately does **not** use Tailwind — `@page`, `break-inside`, and `print-color-adjust` have no Tailwind expression and the PDF path must not depend on a hashed build asset.

## Global Constraints

- TypeScript strict; never `any`. No `console.log` server-side. No new dependencies beyond `playwright-core` and `@sparticuz/chromium`.
- **One source of numbers:** every expected date, drift figure, at-risk flag, and procurement tally comes from `getScheduleData` (`lib/schedule/scheduleRows.ts`). The lookahead computes no forecast of its own. Bar geometry comes from `lib/schedule/timelineGeometry.ts` (`resolveWindow`, `spanPct`, `pointPct`, `axisTicks`, `weekendBands`) — no new date math where those already answer.
- **Spec §4, verbatim:** Page 1 = branded header (SKILES GROUP · project, window title "3-Week Lookahead · Aug 3–23, 2026", status date, generated date), stat strip (drift, at-risk, % complete, starting-this-window count), attention box in **generated sentences** (procurement flags, drift causes from `pushedBy`, stale-update warning), milestone strip (window milestones plus the next 2–3 beyond, planned vs expected diamonds). Pages 2+ = trade-banded bar grid: weeks as columns with day ticks, weekends shaded, color-banded trade headers carrying partner names, band color a **stable hash of the trade name** (same trade = same color across projects and weeks), untraded activities in a final "Unassigned" band; rows carry name, red drift delta when nonzero, expected bar with % complete fill, grey ghost tick at planned finish when it differs, milestone diamonds. A band never splits across pages unless it alone exceeds a page.
- **Page size:** 11×17 (tabloid) landscape is standard, letter landscape is the fallback, user-selectable at export via `size=tabloid|letter`.
- **Scope guard:** view-only output. No stored export history — the dated filename is the record. No editing, no new writes to any table.
- **Filename:** `<project-slug>-<weeks>wk-lookahead-<YYYY-MM-DD>.pdf`.
- **Weeks start Monday (UTC)**, matching `mondayOfWeek`. All formatting is `timeZone: "UTC"`, matching `fmtShortDate`.
- Component tests: first line `// @vitest-environment happy-dom`, `@testing-library/react`, `cleanup()` in `afterEach`. DB-backed tests use `describe.runIf(!!process.env.DATABASE_URL)` and delete the project in `afterAll`, matching `tests/schedule/scheduleRows.test.ts`.
- Preserve everything else: the Schedule and Data Health tabs, XML export, update flow, and OS packet are untouched. `ExportMenu` gains items only.
- Commit directly to `master`, one commit per task. `npm run build` and `npm test` before finishing.
- Deliberate deferrals (do NOT build): stored export history; a size toggle in the Export menu (the route's own toolbar owns it); click-away close on the `<details>` menu; per-page footers on manual browser print (the browser's own footer stands in — the PDF endpoint supplies the real one).

---

### Task 1: Lookahead view model (pure)

**Files:**
- Create: `lib/lookahead/lookaheadView.ts`
- Test: `tests/lookahead/lookaheadView.test.ts`

**Interfaces:**
- Consumes: `ScheduleRow` (`lib/schedule/types.ts`); `resolveWindow`, `spanPct`, `pointPct`, `axisTicks`, `weekendBands`, `TimelineWindow` (`lib/schedule/timelineGeometry.ts`); `fmtShortDate` (`lib/schedule/weekBuckets.ts`).
- Produces (Tasks 2, 3 and 5 consume exactly these):

```ts
export type LookaheadWeeks = 3 | 6;
export interface TradeColor { bg: string; text: string }
export interface LookaheadStats { driftDays: number; atRiskCount: number; percentComplete: number; startingCount: number }
export interface LookaheadGridRow {
  id: string; name: string; secondaryName: string | null;
  driftDays: number; percentComplete: number;
  isMilestone: boolean; isCritical: boolean; atRisk: boolean;
  bar: { leftPct: number; widthPct: number } | null;
  ghostPct: number | null;          // planned finish tick, only when it differs from expected
  expectedPointPct: number | null;  // milestone diamonds
  plannedPointPct: number | null;
}
export interface LookaheadBand { trade: string; partners: string[]; color: TradeColor; rows: LookaheadGridRow[] }
export interface LookaheadMilestone { name: string; planned: string | null; expected: string | null; driftDays: number; beyondWindow: boolean }
export interface LookaheadView {
  title: string;        // "3-Week Lookahead"
  windowLabel: string;  // "Aug 3–23, 2026"
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
export function tradeColor(trade: string): TradeColor;
export function buildLookaheadView(input: {
  rows: ScheduleRow[];
  projectDriftDays: number;
  statusDate: string;          // ISO
  percentComplete: number;
  lastUpdateDaysAgo: number | null;
  weeks: LookaheadWeeks;
  today: Date;
}): LookaheadView;
```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lookahead/lookaheadView.test.ts
import { describe, it, expect } from "vitest";
import { buildLookaheadView, tradeColor } from "@/lib/lookahead/lookaheadView";
import type { ScheduleRow } from "@/lib/schedule/types";

// Mon Aug 3 2026 starts the window; "today" is mid-week to prove Monday alignment.
const today = new Date("2026-08-05T12:00:00Z");

const row = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: "a1", externalId: 101, wbsCode: "1.2", name: "MEP R/I L2", canonicalScope: "Overhead MEP Rough-In",
  disciplineName: "Mechanical", partnerName: "TDIndustries", atRisk: false, procurement: null,
  type: "task", isCritical: false, outlineLevel: 2,
  plannedStart: "2026-08-03T08:00:00.000Z", plannedFinish: "2026-08-07T17:00:00.000Z",
  expectedStart: "2026-08-03T08:00:00.000Z", expectedFinish: "2026-08-07T17:00:00.000Z",
  driftDays: 0, pushedByName: null, status: "not_started",
  percentComplete: 0, totalSlackDays: 3, durationDays: 5, customFields: {},
  ...over,
});

const build = (rows: ScheduleRow[], over: Partial<Parameters<typeof buildLookaheadView>[0]> = {}) =>
  buildLookaheadView({
    rows, projectDriftDays: 0, statusDate: "2026-08-04T17:00:00.000Z",
    percentComplete: 42, lastUpdateDaysAgo: 2, weeks: 3, today, ...over,
  });

describe("window framing", () => {
  it("titles and labels the window from Monday for the requested weeks", () => {
    const v = build([row()]);
    expect(v.title).toBe("3-Week Lookahead");
    expect(v.windowLabel).toBe("Aug 3–23, 2026");   // inclusive last day = Monday + 21d - 1d
    expect(build([row()], { weeks: 6 }).windowLabel).toBe("Aug 3–Sep 13, 2026");
    expect(v.statusDateLabel).toBe("Aug 4, 2026");
    expect(v.generatedLabel).toBe("Aug 5, 2026");
  });

  it("draws the today line and shades weekends", () => {
    const v = build([row()]);
    expect(v.todayPct).toBeGreaterThan(0);
    expect(v.weekends.length).toBe(3);              // one weekend per week in a 3-week window
    expect(v.ticks.length).toBeGreaterThan(0);
  });
});

describe("banding", () => {
  it("groups by trade, names the partners, and sinks untraded work to a final Unassigned band", () => {
    const v = build([
      row({ id: "a1", disciplineName: "Mechanical", partnerName: "TDIndustries" }),
      row({ id: "a2", name: "Duct", disciplineName: "Mechanical", partnerName: "Acme Air" }),
      row({ id: "a3", name: "Slab", disciplineName: null, partnerName: null }),
      row({ id: "a4", name: "Conduit", disciplineName: "Electrical", partnerName: "Fisk" }),
    ]);
    expect(v.bands.map((b) => b.trade)).toEqual(["Electrical", "Mechanical", "Unassigned"]);
    expect(v.bands[1].partners).toEqual(["Acme Air", "TDIndustries"]);
    expect(v.bands[2].color.bg).toBe("#f1f5f9");    // Unassigned is always the neutral grey
  });

  it("excludes summary rows and anything outside the window", () => {
    const v = build([
      row(),
      row({ id: "s", type: "summary", name: "Level 2" }),
      row({ id: "far", name: "Punch", expectedStart: "2026-12-01T08:00:00.000Z", expectedFinish: "2026-12-05T17:00:00.000Z" }),
    ]);
    expect(v.bands.flatMap((b) => b.rows).map((r) => r.id)).toEqual(["a1"]);
  });

  it("positions the bar, the ghost planned-finish tick, and milestone diamonds", () => {
    const v = build([
      row({ id: "a1", driftDays: 3, expectedFinish: "2026-08-12T17:00:00.000Z", percentComplete: 40 }),
      row({ id: "m1", name: "Permit", type: "milestone", plannedFinish: "2026-08-10T17:00:00.000Z", expectedFinish: "2026-08-13T17:00:00.000Z", driftDays: 3 }),
    ]);
    const rows = v.bands.flatMap((b) => b.rows);
    const bar = rows.find((r) => r.id === "a1")!;
    expect(bar.bar!.widthPct).toBeGreaterThan(0);
    expect(bar.ghostPct).toBeGreaterThan(0);        // planned finish differs from expected
    expect(bar.driftDays).toBe(3);
    const ms = rows.find((r) => r.id === "m1")!;
    expect(ms.isMilestone).toBe(true);
    expect(ms.bar).toBeNull();
    expect(ms.plannedPointPct).toBeGreaterThan(0);
    expect(ms.expectedPointPct).toBeGreaterThan(ms.plannedPointPct!);
  });

  it("drops the ghost tick when planned and expected finish agree", () => {
    expect(build([row()]).bands[0].rows[0].ghostPct).toBeNull();
  });
});

describe("stats", () => {
  it("counts at-risk and starting-this-window work inside the window only", () => {
    const v = build(
      [
        row({ id: "a1", atRisk: true }),
        row({ id: "a2", name: "Late", expectedStart: "2026-08-18T08:00:00.000Z", expectedFinish: "2026-08-20T17:00:00.000Z" }),
        row({ id: "a3", name: "In flight", status: "in_progress", percentComplete: 50 }),
        row({ id: "a4", name: "Next year", atRisk: true, expectedStart: "2027-01-04T08:00:00.000Z", expectedFinish: "2027-01-08T17:00:00.000Z" }),
      ],
      { projectDriftDays: 4 },
    );
    expect(v.stats).toEqual({ driftDays: 4, atRiskCount: 1, percentComplete: 42, startingCount: 2 });
  });
});

describe("attention sentences", () => {
  it("names the procurement flag, the drift cause, and the stale update", () => {
    const v = build(
      [
        row({ id: "a1", atRisk: true, partnerName: "TDIndustries", canonicalScope: "Overhead MEP",
              procurement: { itemCount: 9, behindCount: 3, submittalLateCount: 1, projectedLateCount: 2, releasedAtRiskCount: 0, missingDatesCount: 0 } }),
        row({ id: "a2", canonicalScope: "In-Wall Rough-In", driftDays: 3, pushedByName: "MEP Rough-In",
              expectedFinish: "2026-08-12T17:00:00.000Z" }),
      ],
      { lastUpdateDaysAgo: 12 },
    );
    expect(v.attention).toContain("TDIndustries behind on 3 items — Overhead MEP at risk.");
    expect(v.attention).toContain("In-Wall Rough-In pushed +3d by MEP Rough-In.");
    expect(v.attention).toContain("No progress update in 12 days — figures may be stale.");
  });

  it("says so plainly when nothing is flagged", () => {
    expect(build([row()]).attention).toEqual(["Nothing flagged — in-window work is on plan."]);
  });

  it("attributes unexplained drift to the activity itself", () => {
    const v = build([row({ canonicalScope: "Slab Pour", driftDays: 2, pushedByName: null, expectedFinish: "2026-08-11T17:00:00.000Z" })]);
    expect(v.attention).toContain("Slab Pour is running +2d late.");
  });
});

describe("milestone strip", () => {
  it("keeps window milestones and the next three beyond, in expected order", () => {
    const ms = (id: string, iso: string) =>
      row({ id, name: id, type: "milestone", plannedFinish: iso, expectedFinish: iso, expectedStart: iso, plannedStart: iso });
    const v = build([
      ms("m1", "2026-08-10T17:00:00.000Z"),
      ms("m2", "2026-09-01T17:00:00.000Z"),
      ms("m3", "2026-09-08T17:00:00.000Z"),
      ms("m4", "2026-09-15T17:00:00.000Z"),
      ms("m5", "2026-10-01T17:00:00.000Z"),
    ]);
    expect(v.milestones.map((m) => m.name)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(v.milestones.map((m) => m.beyondWindow)).toEqual([false, true, true, true]);
  });
});

describe("tradeColor", () => {
  it("is stable per trade name and varies across trades", () => {
    expect(tradeColor("Mechanical")).toEqual(tradeColor("Mechanical"));
    expect(tradeColor("Mechanical")).not.toEqual(tradeColor("Electrical"));
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/lookahead/lookaheadView.test.ts`
Expected: FAIL — cannot resolve `@/lib/lookahead/lookaheadView`.

- [ ] **Step 3: Implement the view model**

```ts
// lib/lookahead/lookaheadView.ts
import { resolveWindow, spanPct, pointPct, axisTicks, weekendBands } from "@/lib/schedule/timelineGeometry";
import type { ScheduleRow } from "@/lib/schedule/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNASSIGNED = "Unassigned";

export type LookaheadWeeks = 3 | 6;
export interface TradeColor { bg: string; text: string }

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
// (types LookaheadStats / LookaheadGridRow / LookaheadBand / LookaheadMilestone /
//  LookaheadView exactly as listed in this task's Interfaces block)

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
    const differs = r.plannedFinish !== null && r.plannedFinish !== r.expectedFinish;
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
        ghostPct: !isMilestone && differs ? pointPct(r.plannedFinish, win) : null,
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

  const startsInWindow = (r: ScheduleRow) => {
    if (!r.expectedStart) return false;
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
  const beyondStart = milestones.findIndex((m) => m.beyondWindow);
  const trimmed = beyondStart === -1 ? milestones : milestones.slice(0, beyondStart + 3);

  return {
    title: `${weeks}-Week Lookahead`,
    windowLabel: `${fmtDay(win.startMs)}–${fmtFull(win.endMs - DAY_MS)}`.replace(
      // "Aug 3–Aug 23, 2026" reads worse than "Aug 3–23, 2026" when the month repeats.
      new RegExp(`–${fmtDay(win.endMs - DAY_MS).split(" ")[0]} `),
      "–",
    ),
    statusDateLabel: fmtFull(input.statusDate),
    generatedLabel: fmtFull(today.toISOString()),
    stats: {
      driftDays: input.projectDriftDays,
      atRiskCount: inWindow.filter((e) => e.row.atRisk).length,
      percentComplete: input.percentComplete,
      startingCount: inWindow.filter((e) => startsInWindow(e.row)).length,
    },
    attention: attentionSentences(inWindow.map((e) => e.row), input.lastUpdateDaysAgo),
    milestones: trimmed,
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
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/lookahead/lookaheadView.test.ts`
Expected: PASS. If `windowLabel` fights the same-month collapse, prefer building it from parts (`sameMonth ? day : full`) exactly as `bucketLabel` does in `lib/schedule/weekBuckets.ts` rather than a regex — copy that shape.

- [ ] **Step 5: Commit**

```bash
git add lib/lookahead/lookaheadView.ts tests/lookahead/lookaheadView.test.ts && git commit -m "feat(lookahead): pure view model for the lookahead sheet"
```

---

### Task 2: Print stylesheet + sheet component

**Files:**
- Create: `components/lookaheadCss.ts`
- Create: `components/LookaheadSheet.tsx`
- Test: `tests/components/LookaheadSheet.test.tsx`

**Interfaces:**
- Consumes: `LookaheadView` and its member types from Task 1.
- Produces:

```ts
export function lookaheadCss(size: "tabloid" | "letter"): string;
export function LookaheadSheet(props: { view: LookaheadView; projectName: string }): JSX.Element;
```

`LookaheadSheet` must stay a **plain synchronous function component with no hooks, no `"use client"`, and no imports outside `lib/`** — Task 5 renders it through `renderToStaticMarkup`, which supports neither client components nor async ones.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/LookaheadSheet.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { LookaheadSheet } from "@/components/LookaheadSheet";
import { lookaheadCss } from "@/components/lookaheadCss";
import type { LookaheadView } from "@/lib/lookahead/lookaheadView";

const view = (over: Partial<LookaheadView> = {}): LookaheadView => ({
  title: "3-Week Lookahead", windowLabel: "Aug 3–23, 2026",
  statusDateLabel: "Aug 4, 2026", generatedLabel: "Aug 5, 2026",
  stats: { driftDays: 4, atRiskCount: 2, percentComplete: 42, startingCount: 7 },
  attention: ["TDIndustries behind on 3 items — Overhead MEP at risk."],
  milestones: [{ name: "Permit", planned: "2026-08-10T17:00:00.000Z", expected: "2026-08-13T17:00:00.000Z", driftDays: 3, beyondWindow: false }],
  bands: [{
    trade: "Mechanical", partners: ["TDIndustries"], color: { bg: "#e0e7ff", text: "#312e81" },
    rows: [{
      id: "a1", name: "Overhead MEP", secondaryName: "MEP R/I L2", driftDays: 3, percentComplete: 40,
      isMilestone: false, isCritical: false, atRisk: true,
      bar: { leftPct: 10, widthPct: 20 }, ghostPct: 25, expectedPointPct: null, plannedPointPct: null,
    }],
  }],
  ticks: [{ leftPct: 5, label: "8/3" }],
  weekends: [{ leftPct: 60, widthPct: 9 }],
  todayPct: 12,
  ...over,
});

afterEach(() => cleanup());

describe("LookaheadSheet", () => {
  it("brands the header with the project and window", () => {
    render(<LookaheadSheet view={view()} projectName="BSW Regional ED" />);
    expect(screen.getByText(/SKILES GROUP/)).toBeTruthy();
    expect(screen.getByText(/BSW Regional ED/)).toBeTruthy();
    expect(screen.getByText("3-Week Lookahead · Aug 3–23, 2026")).toBeTruthy();
    expect(screen.getByText(/Status date Aug 4, 2026/)).toBeTruthy();
    expect(screen.getByText(/Generated Aug 5, 2026/)).toBeTruthy();
  });

  it("shows the four stats, the attention sentences, and the milestone diamonds", () => {
    render(<LookaheadSheet view={view()} projectName="P" />);
    expect(screen.getByText("+4d")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("TDIndustries behind on 3 items — Overhead MEP at risk.")).toBeTruthy();
    expect(screen.getByText(/◇ Aug 10 → ◆ Aug 13/)).toBeTruthy();
  });

  it("bands rows by trade with the partner names and the band color", () => {
    const { container } = render(<LookaheadSheet view={view()} projectName="P" />);
    const band = container.querySelector<HTMLElement>("[data-band='Mechanical']")!;
    expect(band.style.backgroundColor).toBeTruthy();
    expect(screen.getByText(/TDIndustries/)).toBeTruthy();
    expect(screen.getByText("Overhead MEP")).toBeTruthy();
    expect(screen.getByText("+3d")).toBeTruthy();
    const bar = container.querySelector<HTMLElement>("[data-bar='expected']")!;
    expect(bar.style.left).toBe("10%");
    expect(bar.style.width).toBe("20%");
    expect(container.querySelector("[data-ghost]")).toBeTruthy();
  });

  it("says so when no activity falls in the window", () => {
    render(<LookaheadSheet view={view({ bands: [] })} projectName="P" />);
    expect(screen.getByText(/No activities fall in this window/)).toBeTruthy();
  });
});

describe("lookaheadCss", () => {
  it("sets the page size per format and never splits a band", () => {
    expect(lookaheadCss("tabloid")).toContain("size: 17in 11in");
    expect(lookaheadCss("letter")).toContain("size: 11in 8.5in");
    expect(lookaheadCss("tabloid")).toContain("break-inside: avoid");
    expect(lookaheadCss("tabloid")).toContain("print-color-adjust: exact");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/components/LookaheadSheet.test.tsx`
Expected: FAIL — cannot resolve `@/components/LookaheadSheet`.

- [ ] **Step 3: Write the stylesheet**

```ts
// components/lookaheadCss.ts
// The lookahead is the one print-first surface in the app, so it carries its own
// CSS instead of Tailwind: @page, break-inside and print-color-adjust have no
// utility-class equivalent, and the PDF endpoint (which renders this markup
// standalone in headless Chromium) must not depend on a hashed build asset.
const PAGE = { tabloid: "17in 11in", letter: "11in 8.5in" } as const;

export function lookaheadCss(size: "tabloid" | "letter"): string {
  return `
@page { size: ${PAGE[size]}; margin: 0.4in; }
* { box-sizing: border-box; }
body { margin: 0; }
.sheet { font: 11px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.hd { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 6px; }
.hd-brand { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.hd-title { font-size: 16px; font-weight: 700; }
.hd-meta { font-size: 10px; color: #475569; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0; }
.stat { border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px; text-align: center; }
.stat-n { font-size: 18px; font-weight: 700; }
.stat-n.bad { color: #dc2626; }
.stat-n.warn { color: #b45309; }
.stat-l { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
.box { border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px 10px; margin-bottom: 10px; }
.box h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #64748b; margin: 0 0 4px; }
.box ul { margin: 0; padding-left: 16px; }
.box li { margin: 1px 0; }
.ms { display: flex; flex-wrap: wrap; gap: 6px; }
.ms-chip { border: 1px solid #cbd5e1; border-radius: 999px; padding: 2px 8px; white-space: nowrap; }
.ms-chip.beyond { border-style: dashed; color: #475569; }
.ms-drift { color: #dc2626; font-weight: 700; }
.pagebreak { break-before: page; }
.axis { display: flex; border-bottom: 1px solid #94a3b8; font-size: 9px; color: #64748b; }
.axis-name { flex: 0 0 26%; font-weight: 600; }
.axis-time { position: relative; flex: 1; height: 14px; }
.axis-time span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.band { break-inside: avoid; margin-top: 8px; }
.band-hd { display: flex; justify-content: space-between; padding: 3px 6px; font-weight: 700; border-radius: 3px 3px 0 0; }
.band-partners { font-weight: 400; font-size: 9px; }
.row { display: flex; align-items: stretch; border-bottom: 1px solid #e2e8f0; break-inside: avoid; }
.row-name { flex: 0 0 26%; padding: 3px 6px; }
.row-name .alt { color: #94a3b8; font-size: 9px; margin-left: 4px; }
.row-name .risk { color: #b45309; font-weight: 700; font-size: 9px; margin-left: 4px; }
.row-name .crit { color: #b91c1c; }
.row-time { position: relative; flex: 1; min-height: 16px; }
.wknd { position: absolute; top: 0; bottom: 0; background: #f1f5f9; }
.today { position: absolute; top: 0; bottom: 0; width: 1px; background: #0891b2; }
.bar { position: absolute; top: 5px; height: 8px; border-radius: 2px; background: #67aebf; overflow: hidden; }
.bar-fill { height: 100%; background: #155e75; }
.ghost { position: absolute; top: 3px; width: 1px; height: 12px; background: #94a3b8; }
.drift { position: absolute; top: 3px; font-size: 9px; font-weight: 700; color: #dc2626; transform: translateX(3px); }
.dia { position: absolute; top: 2px; transform: translateX(-50%); font-size: 11px; }
.dia.planned { color: #94a3b8; }
.dia.expected { color: #4338ca; }
.empty { padding: 16px; text-align: center; color: #64748b; }
.foot { margin-top: 10px; font-size: 9px; color: #64748b; text-align: right; }
@media print { .no-print { display: none !important; } }
`.trim();
}
```

- [ ] **Step 4: Write the sheet component**

```tsx
// components/LookaheadSheet.tsx
import type { LookaheadView } from "@/lib/lookahead/lookaheadView";

// No hooks, no "use client", no async: Task 5 renders this exact tree through
// renderToStaticMarkup for the PDF, so screen and paper cannot drift.
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function LookaheadSheet({ view, projectName }: { view: LookaheadView; projectName: string }) {
  return (
    <div className="sheet">
      <header className="hd">
        <div>
          <div className="hd-brand">Skiles Group · {projectName}</div>
          <div className="hd-title">{view.title} · {view.windowLabel}</div>
        </div>
        <div className="hd-meta">
          Status date {view.statusDateLabel}
          <br />
          Generated {view.generatedLabel}
        </div>
      </header>

      <div className="stats">
        <div className="stat">
          <div className={`stat-n ${view.stats.driftDays > 0 ? "bad" : ""}`}>
            {view.stats.driftDays > 0 ? `+${view.stats.driftDays}d` : "on plan"}
          </div>
          <div className="stat-l">projected drift</div>
        </div>
        <div className="stat">
          <div className={`stat-n ${view.stats.atRiskCount > 0 ? "warn" : ""}`}>{view.stats.atRiskCount}</div>
          <div className="stat-l">at risk</div>
        </div>
        <div className="stat">
          <div className="stat-n">{view.stats.percentComplete}%</div>
          <div className="stat-l">complete</div>
        </div>
        <div className="stat">
          <div className="stat-n">{view.stats.startingCount}</div>
          <div className="stat-l">starting this window</div>
        </div>
      </div>

      <section className="box">
        <h2>Needs attention</h2>
        <ul>{view.attention.map((s) => <li key={s}>{s}</li>)}</ul>
      </section>

      {view.milestones.length > 0 && (
        <section className="box">
          <h2>Milestones</h2>
          <div className="ms">
            {view.milestones.map((m) => (
              <span key={m.name + (m.expected ?? "")} className={`ms-chip${m.beyondWindow ? " beyond" : ""}`}>
                {m.name} · ◇ {m.planned ? fmtDay(m.planned) : "—"} → ◆ {m.expected ? fmtDay(m.expected) : "—"}
                {m.driftDays > 0 && <span className="ms-drift"> +{m.driftDays}d</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="pagebreak" />

      {view.bands.length === 0 ? (
        <p className="empty">No activities fall in this window.</p>
      ) : (
        <>
          <div className="axis">
            <div className="axis-name">Activity</div>
            <div className="axis-time">
              {view.ticks.map((t) => (
                <span key={t.label + t.leftPct} style={{ left: `${t.leftPct}%` }}>{t.label}</span>
              ))}
            </div>
          </div>
          {view.bands.map((band) => (
            <section key={band.trade} className="band">
              <div className="band-hd" data-band={band.trade} style={{ background: band.color.bg, color: band.color.text }}>
                <span>{band.trade}</span>
                <span className="band-partners">{band.partners.join(" · ")}</span>
              </div>
              {band.rows.map((r) => (
                <div key={r.id} className="row">
                  <div className="row-name">
                    <span className={r.isCritical ? "crit" : ""}>{r.name}</span>
                    {r.secondaryName && <span className="alt">{r.secondaryName}</span>}
                    {r.atRisk && <span className="risk">AT RISK</span>}
                  </div>
                  <div className="row-time">
                    {view.weekends.map((w, i) => (
                      <div key={i} className="wknd" style={{ left: `${w.leftPct}%`, width: `${w.widthPct}%` }} />
                    ))}
                    {view.todayPct !== null && <div className="today" style={{ left: `${view.todayPct}%` }} />}
                    {r.bar && (
                      <div data-bar="expected" className="bar" style={{ left: `${r.bar.leftPct}%`, width: `${r.bar.widthPct}%` }}>
                        <div className="bar-fill" style={{ width: `${r.percentComplete}%` }} />
                      </div>
                    )}
                    {r.ghostPct !== null && <div data-ghost className="ghost" style={{ left: `${r.ghostPct}%` }} />}
                    {r.plannedPointPct !== null && (
                      <span className="dia planned" style={{ left: `${r.plannedPointPct}%` }}>◇</span>
                    )}
                    {r.expectedPointPct !== null && (
                      <span className="dia expected" style={{ left: `${r.expectedPointPct}%` }}>◆</span>
                    )}
                    {r.bar && r.driftDays > 0 && (
                      <span className="drift" style={{ left: `${Math.min(r.bar.leftPct + r.bar.widthPct, 96)}%` }}>
                        +{r.driftDays}d
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
      <p className="foot">Exported from Schedule Manager</p>
    </div>
  );
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run tests/components/LookaheadSheet.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/LookaheadSheet.tsx components/lookaheadCss.ts tests/components/LookaheadSheet.test.tsx && git commit -m "feat(lookahead): print-first sheet component and stylesheet"
```

---

### Task 3: Server assembler + lookahead route

**Files:**
- Create: `lib/lookahead/getLookahead.ts`
- Create: `app/projects/[id]/lookahead/page.tsx`
- Test: `tests/lookahead/getLookahead.test.ts`

**Interfaces:**
- Consumes: `getScheduleData` (`lib/schedule/scheduleRows.ts`), `getScheduleHealth` (`lib/health/healthService.ts`), `buildLookaheadView` (Task 1), `LookaheadSheet` + `lookaheadCss` (Task 2), `prisma` (`lib/db.ts`).
- Produces (Task 5 consumes exactly this):

```ts
export type PageSize = "tabloid" | "letter";
export interface LookaheadPayload { view: LookaheadView; projectName: string }
export function parseWeeks(raw: string | undefined): LookaheadWeeks;   // 6 only when "6"; else 3
export function parseSize(raw: string | undefined): PageSize;          // "letter" only when "letter"; else tabloid
export async function getLookahead(projectId: string, weeks: LookaheadWeeks, today: Date): Promise<LookaheadPayload | null>;
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/lookahead/getLookahead.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getLookahead, parseWeeks, parseSize } from "@/lib/lookahead/getLookahead";

describe("param parsing", () => {
  it("defaults to a 3-week tabloid sheet and accepts only the known widenings", () => {
    expect(parseWeeks(undefined)).toBe(3);
    expect(parseWeeks("6")).toBe(6);
    expect(parseWeeks("9")).toBe(3);
    expect(parseSize(undefined)).toBe("tabloid");
    expect(parseSize("letter")).toBe("letter");
    expect(parseSize("a4")).toBe("tabloid");
  });
});

describe.runIf(!!process.env.DATABASE_URL)("getLookahead", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("returns null without an import and a banded view once one exists", async () => {
    const project = await prisma.project.create({ data: { name: "Lookahead Test" } });
    projectId = project.id;
    expect(await getLookahead(project.id, 3, new Date("2026-08-05T12:00:00Z"))).toBeNull();

    const imp = await prisma.scheduleImport.create({
      data: {
        projectId: project.id, sourceFormat: "msproject_xml", fileName: "f.xml", fileHash: "lh-h",
        statusDate: new Date("2026-08-04T17:00:00Z"), minutesPerDay: 480,
      },
    });
    await prisma.activity.create({
      data: {
        scheduleImportId: imp.id, externalUid: 1, canonicalActivityKey: "1|lh", name: "Overhead MEP", type: "task",
        wbsCode: "1.1", plannedStart: new Date("2026-08-03T08:00:00Z"), plannedFinish: new Date("2026-08-07T17:00:00Z"),
        durationDays: 5, percentComplete: 0, outlineLevel: 2,
      },
    });

    const out = await getLookahead(project.id, 3, new Date("2026-08-05T12:00:00Z"));
    expect(out).not.toBeNull();
    expect(out!.projectName).toBe("Lookahead Test");
    expect(out!.view.title).toBe("3-Week Lookahead");
    expect(out!.view.bands.flatMap((b) => b.rows).map((r) => r.name)).toEqual(["Overhead MEP"]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/lookahead/getLookahead.test.ts`
Expected: FAIL — cannot resolve `@/lib/lookahead/getLookahead`.

- [ ] **Step 3: Write the assembler**

```ts
// lib/lookahead/getLookahead.ts
import { prisma } from "@/lib/db";
import { getScheduleHealth } from "@/lib/health/healthService";
import { getScheduleData } from "@/lib/schedule/scheduleRows";
import { buildLookaheadView, type LookaheadView, type LookaheadWeeks } from "./lookaheadView";

export type PageSize = "tabloid" | "letter";
export interface LookaheadPayload { view: LookaheadView; projectName: string }

export function parseWeeks(raw: string | undefined): LookaheadWeeks {
  return raw === "6" ? 6 : 3;
}
export function parseSize(raw: string | undefined): PageSize {
  return raw === "letter" ? "letter" : "tabloid";
}

/** The one server-side load behind both the screen route and the PDF endpoint. */
export async function getLookahead(
  projectId: string,
  weeks: LookaheadWeeks,
  today: Date,
): Promise<LookaheadPayload | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) return null;
  const schedule = await getScheduleData(projectId);
  if (!schedule) return null;

  const health = await getScheduleHealth(projectId);
  const lastFinalized = await prisma.progressUpdate.findFirst({
    where: { projectId, state: "finalized" },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });

  return {
    projectName: project.name,
    view: buildLookaheadView({
      rows: schedule.rows,
      projectDriftDays: schedule.projectDriftDays,
      statusDate: schedule.statusDate,
      percentComplete: health.hasImport ? health.progress.percentComplete : 0,
      lastUpdateDaysAgo: lastFinalized
        ? Math.max(0, Math.floor((today.getTime() - lastFinalized.asOfDate.getTime()) / 86_400_000))
        : null,
      weeks,
      today,
    }),
  };
}
```

- [ ] **Step 4: Write the route**

```tsx
// app/projects/[id]/lookahead/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { LookaheadSheet } from "@/components/LookaheadSheet";
import { lookaheadCss } from "@/components/lookaheadCss";
import { appPath } from "@/lib/http";
import { getLookahead, parseSize, parseWeeks } from "@/lib/lookahead/getLookahead";

export const dynamic = "force-dynamic";

export default async function LookaheadPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ weeks?: string; size?: string }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const weeks = parseWeeks(sp.weeks);
  const size = parseSize(sp.size);

  const payload = await getLookahead(id, weeks, new Date());
  if (!payload) notFound();

  const href = (w: number, s: string) => `/projects/${id}/lookahead?weeks=${w}&size=${s}`;
  const tab = (active: boolean) =>
    `rounded border px-2 py-1 ${active ? "border-cyan-700 bg-cyan-700 text-white" : "border-slate-300 bg-white text-slate-700"}`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: lookaheadCss(size) }} />
      <div className="no-print mx-auto flex max-w-5xl flex-wrap items-center gap-2 p-4 text-sm">
        <Link href={`/projects/${id}`} className="mr-auto text-cyan-700 hover:underline">← Schedule</Link>
        <Link href={href(3, size)} className={tab(weeks === 3)}>3 wk</Link>
        <Link href={href(6, size)} className={tab(weeks === 6)}>6 wk</Link>
        <span className="mx-1 text-slate-300">|</span>
        <Link href={href(weeks, "tabloid")} className={tab(size === "tabloid")}>11×17</Link>
        <Link href={href(weeks, "letter")} className={tab(size === "letter")}>Letter</Link>
        <a
          href={appPath(`/api/export/lookahead-pdf?projectId=${id}&weeks=${weeks}&size=${size}`)}
          className="rounded-lg bg-cyan-700 px-3 py-1.5 font-medium text-white hover:bg-cyan-800"
        >
          Download PDF
        </a>
      </div>
      <div className="mx-auto max-w-[17in] p-4 print:p-0">
        <LookaheadSheet view={payload.view} projectName={payload.projectName} />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run the test and the type check**

Run: `npx vitest run tests/lookahead/getLookahead.test.ts && npx tsc --noEmit`
Expected: PASS, clean types. (Without `DATABASE_URL` the db block is skipped — that is expected, the parsing block still runs.)

- [ ] **Step 6: Commit**

```bash
git add lib/lookahead/getLookahead.ts app/projects/\[id\]/lookahead/page.tsx tests/lookahead/getLookahead.test.ts && git commit -m "feat(lookahead): screen route serving the printable sheet"
```

---

### Task 4: Export menu entries

**Files:**
- Modify: `components/ExportMenu.tsx`
- Test: `tests/components/ShellComponents.test.tsx` (add a case)

**Interfaces:**
- Consumes: the route from Task 3. No signature change — `ExportMenu({ projectId })` stands.

- [ ] **Step 1: Add the failing test case**

```tsx
// append inside the existing ExportMenu describe block in tests/components/ShellComponents.test.tsx
  it("offers both lookahead windows alongside the XML export", () => {
    const { container } = render(<ExportMenu projectId="p1" />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/projects/p1/lookahead?weeks=3");
    expect(hrefs).toContain("/projects/p1/lookahead?weeks=6");
    expect(hrefs).toContain("/projects/p1/export");
  });
```

If `ShellComponents.test.tsx` has no `ExportMenu` describe block yet, add one importing `ExportMenu` from `@/components/ExportMenu` and following that file's existing render/cleanup shape.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/components/ShellComponents.test.tsx`
Expected: FAIL — the lookahead hrefs are missing.

- [ ] **Step 3: Add the items**

```tsx
// components/ExportMenu.tsx — inside the dropdown div, above the MS Project XML link
        <Link href={`/projects/${projectId}/lookahead?weeks=3`} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          3-Week Lookahead
        </Link>
        <Link href={`/projects/${projectId}/lookahead?weeks=6`} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          6-Week Lookahead
        </Link>
        <div className="my-1 border-t border-slate-100" />
```

Also update the file's header comment: the "Phase 4 adds the Lookahead PDF items" note is now done — say instead that page size is chosen on the lookahead route itself, keeping this menu to two windows.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/components/ShellComponents.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/ExportMenu.tsx tests/components/ShellComponents.test.tsx && git commit -m "feat(lookahead): reach the lookahead sheet from the Export menu"
```

---

### Task 5: PDF download endpoint

**Files:**
- Create: `lib/lookahead/pdfDocument.ts`
- Create: `app/api/export/lookahead-pdf/route.ts`
- Modify: `next.config.mjs`
- Modify: `package.json` (add `playwright-core`, `@sparticuz/chromium`)
- Test: `tests/lookahead/pdfDocument.test.ts`

**Interfaces:**
- Consumes: `getLookahead`, `parseWeeks`, `parseSize` (Task 3); `LookaheadSheet`, `lookaheadCss` (Task 2); `denyIfOutOfScope` (`lib/scope.ts`).
- Produces:

```ts
export function lookaheadDocument(bodyHtml: string, css: string): string;
export function pdfFileName(projectName: string, weeks: number, today: Date): string;
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/lookahead/pdfDocument.test.ts
import { describe, it, expect } from "vitest";
import { lookaheadDocument, pdfFileName } from "@/lib/lookahead/pdfDocument";

describe("lookaheadDocument", () => {
  it("wraps the markup in a standalone document carrying its own styles", () => {
    const html = lookaheadDocument("<div class='sheet'>x</div>", "@page { size: 17in 11in; }");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@page { size: 17in 11in; }");
    expect(html).toContain("<div class='sheet'>x</div>");
    expect(html).not.toContain("<link");   // nothing to fetch — setContent has no origin
  });
});

describe("pdfFileName", () => {
  it("slugs the project and dates the file", () => {
    expect(pdfFileName("BSW Regional ED / Phase 2", 3, new Date("2026-08-05T12:00:00Z")))
      .toBe("bsw-regional-ed-phase-2-3wk-lookahead-2026-08-05.pdf");
  });
  it("falls back when the name slugs to nothing", () => {
    expect(pdfFileName("///", 6, new Date("2026-08-05T12:00:00Z")))
      .toBe("project-6wk-lookahead-2026-08-05.pdf");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/lookahead/pdfDocument.test.ts`
Expected: FAIL — cannot resolve `@/lib/lookahead/pdfDocument`.

- [ ] **Step 3: Write the document builder**

```ts
// lib/lookahead/pdfDocument.ts
/**
 * The PDF is produced from a standalone document handed to Chromium via
 * setContent — not by navigating to the route. That keeps the endpoint free of
 * a base URL, a session cookie, and the hashed CSS asset, and it is why the
 * sheet carries its own stylesheet.
 */
export function lookaheadDocument(bodyHtml: string, css: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${bodyHtml}</body></html>`;
}

export function pdfFileName(projectName: string, weeks: number, today: Date): string {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  return `${slug}-${weeks}wk-lookahead-${today.toISOString().slice(0, 10)}.pdf`;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/lookahead/pdfDocument.test.ts`
Expected: PASS.

- [ ] **Step 5: Install the PDF dependencies**

```bash
npm install playwright-core @sparticuz/chromium
```

Then declare them external so Next does not try to bundle the Chromium binary:

```js
// next.config.mjs — add inside nextConfig, with a comment saying why
  // The Chromium binary and its launcher must stay outside the server bundle:
  // webpack cannot bundle a 50MB brotli-packed executable, and Playwright
  // resolves it from disk at runtime.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
```

- [ ] **Step 6: Write the endpoint**

```tsx
// app/api/export/lookahead-pdf/route.ts
import { NextResponse } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";
import { LookaheadSheet } from "@/components/LookaheadSheet";
import { lookaheadCss } from "@/components/lookaheadCss";
import { getLookahead, parseSize, parseWeeks } from "@/lib/lookahead/getLookahead";
import { lookaheadDocument, pdfFileName } from "@/lib/lookahead/pdfDocument";
import { denyIfOutOfScope } from "@/lib/scope";

// Chromium cold-starts slowly on a first invocation; the default 15s is not enough.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  if (!projectId) {
    return NextResponse.json({ error: { message: "projectId is required." } }, { status: 400 });
  }
  const denied = await denyIfOutOfScope(req, projectId);
  if (denied) return denied;

  const weeks = parseWeeks(url.searchParams.get("weeks") ?? undefined);
  const size = parseSize(url.searchParams.get("size") ?? undefined);
  const today = new Date();

  const payload = await getLookahead(projectId, weeks, today);
  if (!payload) {
    return NextResponse.json({ error: { message: "No schedule imported for this project." } }, { status: 404 });
  }

  const html = lookaheadDocument(
    renderToStaticMarkup(<LookaheadSheet view={payload.view} projectName={payload.projectName} />),
    lookaheadCss(size),
  );

  // Local and self-hosted runs point at an installed browser; on Vercel the
  // @sparticuz build is the only Chromium present.
  const executablePath = process.env.CHROME_EXECUTABLE_PATH ?? (await chromium.executablePath());
  const browser = await playwright.launch({ args: chromium.args, executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;padding:0 .4in;font:8px sans-serif;color:#64748b;text-align:right;">Exported from Schedule Manager · page <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
      margin: { top: "0.4in", bottom: "0.5in", left: "0.4in", right: "0.4in" },
    });
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFileName(payload.projectName, weeks, today)}"`,
      },
    });
  } finally {
    await browser.close();
  }
}
```

The file must be `route.tsx` (not `.ts`) — it contains JSX.

- [ ] **Step 7: Verify the endpoint end to end**

Run `npm run dev`, open `/projects/<id>/lookahead?weeks=3`, click **Download PDF**, and confirm a tabloid-landscape PDF downloads with the summary page first and trade bands after. If Chromium cannot launch locally, set `CHROME_EXECUTABLE_PATH` to an installed Chrome/Chromium and retry; if no browser is available in this environment at all, record that the endpoint is unverified locally and verify on the first deployment — do not claim it works.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json next.config.mjs lib/lookahead/pdfDocument.ts app/api/export/lookahead-pdf/route.tsx tests/lookahead/pdfDocument.test.ts && git commit -m "feat(lookahead): stream the meeting PDF from headless Chromium"
```

---

### Task 6: Full verification

**Files:** none created — this task proves the phase.

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: PASS, no skipped-by-error suites.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean. Watch specifically for the `/api/export/lookahead-pdf` route compiling and for no attempt to bundle the Chromium binary (if it tries, `serverExternalPackages` from Task 5 Step 5 is missing or misspelled).

- [ ] **Step 3: Walk the surface**

With `npm run dev`: `/projects/<id>` → Export ▾ shows both lookahead entries → 3-Week Lookahead opens the sheet → the 6 wk and Letter toggles reframe it → browser Print preview shows the summary page then trade bands, no band split mid-trade, weekends shaded → Download PDF returns the dated file. Confirm the Schedule tab, Data Health tab, and XML export are unchanged.

- [ ] **Step 4: Report**

State plainly what was verified and what was not (particularly if Chromium could not launch locally). Do not commit anything in this task.

---

## Not in this phase

- Stored export history — the dated filename is the record (spec §4 scope guard).
- A per-page footer on manual browser Print; the browser supplies its own. The endpoint's PDF carries the real "page n/N" footer.
- Click-away close on the `<details>` Export menu (phase-2 deferred minor, still deferred — navigation closes it in practice).
- The progress-capture form restyled as bucket cards (parked phase-3.5 candidate).
- Any change to the forecast engine, the OS packet, the update flow, or the XML export.
