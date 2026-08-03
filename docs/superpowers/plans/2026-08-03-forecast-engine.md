# Forecast/Drift Engine Implementation Plan (Redesign Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure forward-pass forecast engine in `lib/forecast/` that produces expected dates, drift (working days), and push attribution per activity, plus a project-level drift figure and one server-side loader every later phase reads.

**Architecture:** Three small pure modules — working-day date math, the forward pass, project drift — plus one thin Prisma wrapper. No schema changes, no stored state, no UI. Spec: `docs/superpowers/specs/2026-08-03-schedule-ui-redesign-design.md`, Section 1.

**Tech Stack:** TypeScript (strict), Vitest, Prisma (wrapper task only). Tests follow existing repo conventions: `@/` path alias, pure tests unconditional, DB tests gated with `describe.runIf(!!process.env.DATABASE_URL)`.

## Global Constraints

- TypeScript strict mode; never `any` to silence errors.
- No `console.log` in server-side code.
- Engine rules come verbatim from the spec: completed → actuals; in-progress → status date + remaining duration (planned duration × (1 − %/100), working days); not-started → pushed by FS/SS predecessors + lag; **never earlier than planned**; no float math / leveling / holiday calendars (weekends only); project drift = drift of the latest-finishing incomplete activity; an activity with an actual start is never pushed (out-of-sequence edges skipped).
- FF/SF relationships do **not** push in v1 (documented in code).
- Dates are UTC timestamps as imported from MS Project XML (starts ~08:00, finishes ~17:00). The engine is **date-granular**: pushes are computed in whole working days and applied by shifting the planned timestamps, so planned dates are reproduced exactly when nothing slips and drift propagates undiminished through zero-lag FS chains. The known v1 approximation: FS lag is `nextWorkingDate(predFinish) + lag` rather than MSP's working-time arithmetic, which can differ from MSP's displayed start by one day when lag > 0.
- `Relationship.type` in the DB is already canonical (`"FS" | "SS" | "FF" | "SF"` — `parseMspXml.ts:149` maps codes at import). Do not run it through `mapRelationshipType` again (that function maps *numeric codes* and would turn the string `"SS"` into its `"FS"` fallback).
- Commit directly to `master` (repo convention — no feature branches).
- Run `npm run build` and `npm test` before finishing.

---

### Task 1: Working-day date math

**Files:**
- Create: `lib/forecast/workingDays.ts`
- Test: `tests/forecast/workingDays.test.ts`

**Interfaces:**
- Consumes: nothing (pure stdlib).
- Produces:
  - `isWeekend(d: Date): boolean` — UTC Saturday/Sunday.
  - `addWorkingDays(start: Date, days: number): Date` — advance `days ≥ 0` working days (fractional allowed), skipping weekends; a start landing on a weekend rolls forward to Monday first.
  - `workingDaysBetween(a: Date, b: Date): number` — whole working days from `a`'s UTC date to `b`'s UTC date; 0 for same date; negative when `b` is earlier; a step landing on a weekend does not count (Fri → next Mon = 1). Date-granular: times of day are ignored.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/forecast/workingDays.test.ts
import { describe, it, expect } from "vitest";
import { isWeekend, addWorkingDays, workingDaysBetween } from "@/lib/forecast/workingDays";

// 2026-08-03 is a Monday.
const mon = new Date("2026-08-03T08:00:00Z");
const fri = new Date("2026-08-07T17:00:00Z");
const sat = new Date("2026-08-08T10:00:00Z");

describe("isWeekend", () => {
  it("is false for Monday and true for Saturday/Sunday (UTC)", () => {
    expect(isWeekend(mon)).toBe(false);
    expect(isWeekend(sat)).toBe(true);
    expect(isWeekend(new Date("2026-08-09T10:00:00Z"))).toBe(true);
  });
});

describe("addWorkingDays", () => {
  it("adds zero days as identity on a weekday", () => {
    expect(addWorkingDays(mon, 0).toISOString()).toBe(mon.toISOString());
  });
  it("rolls a weekend start forward to Monday even for zero days", () => {
    expect(addWorkingDays(sat, 0).toISOString()).toBe("2026-08-10T10:00:00.000Z");
  });
  it("adds whole days within a week, preserving time of day", () => {
    const r = addWorkingDays(mon, 3);
    expect(r.getUTCDate()).toBe(6); // Mon Aug 3 + 3 → Thu Aug 6
    expect(r.getUTCHours()).toBe(8);
  });
  it("skips the weekend", () => {
    expect(addWorkingDays(fri, 1).getUTCDate()).toBe(10); // Fri + 1 → Mon Aug 10
    expect(addWorkingDays(mon, 5).getUTCDate()).toBe(10); // Mon + 5 → next Mon
  });
  it("carries fractional days as clock time", () => {
    const r = addWorkingDays(mon, 2.5);
    expect(r.getUTCDate()).toBe(5);   // Mon + 2 → Wed Aug 5 ...
    expect(r.getUTCHours()).toBe(20); // ... + 0.5 × 24h from 08:00 → 20:00
  });
  it("rolls a fractional landing off the weekend", () => {
    const r = addWorkingDays(fri, 0.5); // Fri 17:00 + 12h = Sat 05:00 → Mon 05:00
    expect(r.getUTCDay()).toBe(1);
    expect(r.getUTCHours()).toBe(5);
  });
});

describe("workingDaysBetween", () => {
  it("is 0 for the same UTC date regardless of time", () => {
    expect(workingDaysBetween(new Date("2026-08-03T01:00:00Z"), new Date("2026-08-03T23:00:00Z"))).toBe(0);
  });
  it("counts weekdays forward", () => {
    expect(workingDaysBetween(mon, new Date("2026-08-06T00:00:00Z"))).toBe(3);
  });
  it("does not count weekend days", () => {
    expect(workingDaysBetween(fri, new Date("2026-08-10T00:00:00Z"))).toBe(1); // Fri → Mon
    expect(workingDaysBetween(fri, sat)).toBe(0);                              // Fri → Sat
  });
  it("is negative when b precedes a", () => {
    expect(workingDaysBetween(new Date("2026-08-10T00:00:00Z"), fri)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/forecast/workingDays.test.ts`
Expected: FAIL — cannot resolve `@/lib/forecast/workingDays`.

- [ ] **Step 3: Implement**

```ts
// lib/forecast/workingDays.ts
const DAY_MS = 24 * 60 * 60 * 1000;

export function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function rollForwardToWeekday(t: number): number {
  while (isWeekend(new Date(t))) t += DAY_MS;
  return t;
}

/**
 * Advance `days` working days (fractional allowed, must be >= 0) skipping
 * Sat/Sun in UTC. A start on a weekend rolls forward to Monday first, keeping
 * its time of day. Fractional remainders advance clock time and roll off any
 * weekend they land on.
 */
export function addWorkingDays(start: Date, days: number): Date {
  let t = rollForwardToWeekday(start.getTime());
  let whole = Math.floor(days);
  const frac = days - whole;
  while (whole > 0) {
    t = rollForwardToWeekday(t + DAY_MS);
    whole--;
  }
  if (frac > 0) t = rollForwardToWeekday(t + frac * DAY_MS);
  return new Date(t);
}

/**
 * Whole working days from a's UTC date to b's UTC date, ignoring time of day.
 * 0 for the same date; negative when b is earlier. Each forward day-step that
 * lands on a weekday counts, so Fri -> next Mon is 1.
 */
export function workingDaysBetween(a: Date, b: Date): number {
  const dayA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const dayB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  const sign = dayB >= dayA ? 1 : -1;
  const [from, to] = sign === 1 ? [dayA, dayB] : [dayB, dayA];
  let count = 0;
  // ponytail: O(span) day loop — swap for arithmetic if profiling ever cares.
  for (let t = from; t < to; t += DAY_MS) {
    if (!isWeekend(new Date(t + DAY_MS))) count++;
  }
  return sign * count;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/forecast/workingDays.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add lib/forecast/workingDays.ts tests/forecast/workingDays.test.ts
git commit -m "feat(forecast): working-day date math for the drift engine"
```

---

### Task 2: Forward pass — status rules, no relationships yet

**Files:**
- Create: `lib/forecast/computeForecast.ts`
- Modify: `lib/lookahead/computeLookahead.ts:47` (widen `baselineProgress` param type only)
- Test: `tests/forecast/computeForecast.test.ts`

**Interfaces:**
- Consumes: `addWorkingDays`, `workingDaysBetween` from Task 1; `ActivityProgress`, `baselineProgress` from `@/lib/lookahead/computeLookahead`.
- Produces (later tasks and phases rely on these exact names):

```ts
export interface ForecastActivity {
  externalUid: number;
  canonicalActivityKey: string;
  type: string;              // "task" | "milestone" | "summary" | "project_summary"
  isActive: boolean;
  plannedStart: Date | null;
  plannedFinish: Date | null;
  durationDays: number | null;
  actualStart: Date | null;  // imported actuals — starting progress like computeLookahead
  actualFinish: Date | null;
  percentComplete: number | null;
}

export interface ForecastRelationship {
  predecessorExternalUid: number;
  successorExternalUid: number;
  type: string;              // canonical "FS" | "SS" | "FF" | "SF" as stored in the DB
  lagMinutes: number | null;
}

export interface ActivityForecast {
  expectedStart: Date | null;
  expectedFinish: Date | null;
  driftDays: number;         // working days vs plannedFinish; >= 0 while incomplete, may be negative for completed-early history
  pushedByUid: number | null; // predecessor that pushed expectedStart past plannedStart
}

export interface ForecastInput {
  activities: ForecastActivity[];
  relationships: ForecastRelationship[];
  progressByKey: Map<string, ActivityProgress>; // from resolveCurrentProgress
  statusDate: Date;
  minutesPerDay?: number | null;                // lag conversion; default 480
}

export function computeForecast(input: ForecastInput): Map<number, ActivityForecast>; // keyed by externalUid; summaries/inactive omitted
```

First, the one-line groundwork: `baselineProgress` in `computeLookahead.ts` currently demands a full `LookaheadActivity` but only reads three fields. Widen the parameter so the engine can reuse it (existing callers are unaffected — they pass a superset):

```ts
/** Starting progress derived from the imported base schedule's own actuals. */
export function baselineProgress(
  a: Pick<LookaheadActivity, "actualStart" | "actualFinish" | "percentComplete">,
): ActivityProgress {
```

(body unchanged)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/forecast/computeForecast.test.ts
import { describe, it, expect } from "vitest";
import {
  computeForecast,
  type ForecastActivity,
  type ForecastInput,
} from "@/lib/forecast/computeForecast";
import type { ActivityProgress } from "@/lib/lookahead/computeLookahead";

// 2026-08-03 is a Monday; statusDate is the Friday before.
const statusDate = new Date("2026-07-31T17:00:00Z");

export function fa(p: Partial<ForecastActivity>): ForecastActivity {
  return {
    externalUid: 1, canonicalActivityKey: "1|a", type: "task", isActive: true,
    plannedStart: new Date("2026-08-03T08:00:00Z"),
    plannedFinish: new Date("2026-08-07T17:00:00Z"),
    durationDays: 5, actualStart: null, actualFinish: null, percentComplete: null,
    ...p,
  };
}

export const prog = (key: string, p: Partial<ActivityProgress>): Map<string, ActivityProgress> =>
  new Map([[key, { status: "not_started", actualStart: null, actualFinish: null, percentComplete: null, note: null, ...p }]]);

function run(activities: ForecastActivity[], progress?: Map<string, ActivityProgress>, extra?: Partial<ForecastInput>) {
  return computeForecast({ activities, relationships: [], progressByKey: progress ?? new Map(), statusDate, ...extra });
}

describe("computeForecast status rules", () => {
  it("omits summaries, project summaries, and inactive activities", () => {
    const out = run([
      fa({ externalUid: 1, type: "summary" }),
      fa({ externalUid: 2, type: "project_summary" }),
      fa({ externalUid: 3, isActive: false }),
      fa({ externalUid: 4 }),
    ]);
    expect([...out.keys()]).toEqual([4]);
  });

  it("on-plan not-started: expected dates equal planned dates exactly, zero drift", () => {
    const f = run([fa({})]).get(1)!;
    expect(f.expectedStart!.toISOString()).toBe("2026-08-03T08:00:00.000Z");
    expect(f.expectedFinish!.toISOString()).toBe("2026-08-07T17:00:00.000Z");
    expect(f.driftDays).toBe(0);
    expect(f.pushedByUid).toBeNull();
  });

  it("completed: actuals win and drift is frozen history (can be negative)", () => {
    const p = prog("1|a", {
      status: "complete",
      actualStart: new Date("2026-08-03T08:00:00Z"),
      actualFinish: new Date("2026-08-06T17:00:00Z"), // finished Thu, planned Fri
      percentComplete: 100,
    });
    const f = run([fa({})], p).get(1)!;
    expect(f.expectedFinish!.toISOString()).toBe("2026-08-06T17:00:00.000Z");
    expect(f.driftDays).toBe(-1);
  });

  it("in-progress on/ahead of plan clamps to the planned finish", () => {
    // 5-day task, 20% done at Fri Jul 31 statusDate → 4 days remain → Thu Aug 6,
    // earlier than planned Fri Aug 7 → clamped to plan, drift 0.
    const p20 = prog("1|a", { status: "in_progress", percentComplete: 20 });
    const f20 = run([fa({})], p20).get(1)!;
    expect(f20.expectedFinish!.toISOString()).toBe("2026-08-07T17:00:00.000Z");
    expect(f20.driftDays).toBe(0);
    // 90% done → clamp again; never earlier than planned.
    const p90 = prog("1|a", { status: "in_progress", percentComplete: 90 });
    expect(run([fa({})], p90).get(1)!.driftDays).toBe(0);
  });

  it("in-progress behind plan shows positive drift from the status date", () => {
    // statusDate Fri Aug 7, still only 20% done → 4 working days remain → Thu Aug 13 → +4d.
    const p = prog("1|a", { status: "in_progress", percentComplete: 20 });
    const f = computeForecast({
      activities: [fa({})], relationships: [], progressByKey: p,
      statusDate: new Date("2026-08-07T17:00:00Z"),
    }).get(1)!;
    expect(f.driftDays).toBe(4);
    expect(f.expectedFinish!.getUTCDate()).toBe(13);
  });

  it("imported actuals seed progress when no in-app update exists", () => {
    const f = run([fa({ actualStart: new Date("2026-08-03T08:00:00Z"), actualFinish: new Date("2026-08-05T17:00:00Z"), percentComplete: 100 })]).get(1)!;
    expect(f.expectedFinish!.toISOString()).toBe("2026-08-05T17:00:00.000Z");
  });

  it("milestone keeps its planned timestamps when unpushed", () => {
    const ms = new Date("2026-08-03T08:00:00Z");
    const f = run([fa({ type: "milestone", durationDays: 0, plannedStart: ms, plannedFinish: ms })]).get(1)!;
    expect(f.expectedStart!.toISOString()).toBe(ms.toISOString());
    expect(f.expectedFinish!.toISOString()).toBe(ms.toISOString());
  });

  it("null durationDays derives remaining duration from the planned span", () => {
    const p = prog("1|a", { status: "in_progress", percentComplete: 0 });
    // planned Mon Aug 3 .. Fri Aug 7 = 4 working-day span; statusDate Fri Aug 7 + 4 → Thu Aug 13.
    const f = computeForecast({
      activities: [fa({ durationDays: null })], relationships: [], progressByKey: p,
      statusDate: new Date("2026-08-07T17:00:00Z"),
    }).get(1)!;
    expect(f.expectedFinish!.getUTCDate()).toBe(13);
  });

  it("null planned dates degrade gracefully", () => {
    const f = run([fa({ plannedStart: null, plannedFinish: null, durationDays: null })]).get(1)!;
    expect(f.expectedStart).toBeNull();
    expect(f.driftDays).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/forecast/computeForecast.test.ts`
Expected: FAIL — cannot resolve `@/lib/forecast/computeForecast`.

- [ ] **Step 3: Implement**

Apply the `baselineProgress` signature widening shown above, then:

```ts
// lib/forecast/computeForecast.ts
import type { ActivityProgress } from "@/lib/lookahead/computeLookahead";
import { baselineProgress } from "@/lib/lookahead/computeLookahead";
import { addWorkingDays, workingDaysBetween } from "./workingDays";

export interface ForecastActivity {
  externalUid: number;
  canonicalActivityKey: string;
  type: string;
  isActive: boolean;
  plannedStart: Date | null;
  plannedFinish: Date | null;
  durationDays: number | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number | null;
}

export interface ForecastRelationship {
  predecessorExternalUid: number;
  successorExternalUid: number;
  type: string;
  lagMinutes: number | null;
}

export interface ActivityForecast {
  expectedStart: Date | null;
  expectedFinish: Date | null;
  driftDays: number;
  pushedByUid: number | null;
}

export interface ForecastInput {
  activities: ForecastActivity[];
  relationships: ForecastRelationship[];
  progressByKey: Map<string, ActivityProgress>;
  statusDate: Date;
  minutesPerDay?: number | null;
}

interface Edge {
  pred: number;
  succ: number;
  type: "FS" | "SS";
  lagDays: number;
}

function isLeaf(a: ForecastActivity): boolean {
  return a.isActive && a.type !== "summary" && a.type !== "project_summary";
}

function plannedDuration(a: ForecastActivity): number {
  if (a.durationDays !== null) return a.durationDays;
  if (a.plannedStart && a.plannedFinish) return Math.max(0, workingDaysBetween(a.plannedStart, a.plannedFinish));
  return 0;
}

function forecastOne(
  a: ForecastActivity,
  p: ActivityProgress,
  preds: Edge[],
  done: Map<number, ActivityForecast>,
  statusDate: Date,
  skipPush: boolean,
): ActivityForecast {
  if (p.status === "complete") {
    const expectedFinish = p.actualFinish ?? a.plannedFinish;
    return {
      expectedStart: p.actualStart ?? a.plannedStart,
      expectedFinish,
      driftDays: a.plannedFinish && expectedFinish ? workingDaysBetween(a.plannedFinish, expectedFinish) : 0,
      pushedByUid: null,
    };
  }

  if (p.status === "in_progress") {
    // Started work is never pushed by predecessors — reality wins (out-of-sequence rule).
    const pct = Math.min(99, Math.max(0, p.percentComplete ?? 0));
    const remaining = plannedDuration(a) * (1 - pct / 100);
    let expectedFinish = addWorkingDays(statusDate, remaining);
    if (a.plannedFinish && expectedFinish < a.plannedFinish) expectedFinish = a.plannedFinish; // never earlier than planned
    return {
      expectedStart: p.actualStart ?? a.plannedStart,
      expectedFinish,
      driftDays: a.plannedFinish ? Math.max(0, workingDaysBetween(a.plannedFinish, expectedFinish)) : 0,
      pushedByUid: null,
    };
  }

  // Not started. Pushes are computed date-granularly as whole working days and
  // applied by shifting the planned timestamps — so an unpushed activity keeps
  // its planned dates exactly, and drift propagates undiminished through
  // zero-lag FS chains.
  if (!a.plannedStart) {
    return { expectedStart: null, expectedFinish: a.plannedFinish, driftDays: 0, pushedByUid: null };
  }
  let pushDays = 0;
  let pushedByUid: number | null = null;
  if (!skipPush) {
    for (const e of preds) {
      const pf = done.get(e.pred);
      if (!pf) continue;
      // FS: earliest start is the next working date after the predecessor's
      // expected finish, plus lag. SS: starts tie, plus lag.
      const basis = e.type === "FS" ? pf.expectedFinish : pf.expectedStart;
      if (!basis) continue;
      const candidate = addWorkingDays(basis, (e.type === "FS" ? 1 : 0) + e.lagDays);
      const push = workingDaysBetween(a.plannedStart, candidate);
      if (push > pushDays) {
        pushDays = push;
        pushedByUid = e.pred;
      }
    }
  }
  if (pushDays === 0) {
    return { expectedStart: a.plannedStart, expectedFinish: a.plannedFinish, driftDays: 0, pushedByUid: null };
  }
  const expectedStart = addWorkingDays(a.plannedStart, pushDays);
  const expectedFinish = a.plannedFinish
    ? addWorkingDays(a.plannedFinish, pushDays)
    : addWorkingDays(expectedStart, plannedDuration(a));
  return { expectedStart, expectedFinish, driftDays: pushDays, pushedByUid };
}

/**
 * Forward-pass forecast per the redesign spec: completed uses actuals,
 * in-progress extends from the status date, not-started is pushed by FS/SS
 * predecessors, never earlier than planned. Not CPM: no float, no leveling,
 * weekends only; FF/SF edges do not push in v1.
 */
export function computeForecast(input: ForecastInput): Map<number, ActivityForecast> {
  const mpd = input.minutesPerDay || 480;
  const leaves = input.activities.filter(isLeaf);
  const byUid = new Map(leaves.map((a) => [a.externalUid, a]));

  const incoming = new Map<number, Edge[]>();
  const outgoing = new Map<number, Edge[]>();
  const indegree = new Map<number, number>([...byUid.keys()].map((uid) => [uid, 0]));
  for (const r of input.relationships) {
    if (r.type !== "FS" && r.type !== "SS") continue; // FF/SF don't push in v1
    if (!byUid.has(r.predecessorExternalUid) || !byUid.has(r.successorExternalUid)) continue;
    const e: Edge = {
      pred: r.predecessorExternalUid,
      succ: r.successorExternalUid,
      type: r.type,
      lagDays: (r.lagMinutes ?? 0) / mpd,
    };
    if (!incoming.has(e.succ)) incoming.set(e.succ, []);
    incoming.get(e.succ)!.push(e);
    if (!outgoing.has(e.pred)) outgoing.set(e.pred, []);
    outgoing.get(e.pred)!.push(e);
    indegree.set(e.succ, (indegree.get(e.succ) ?? 0) + 1);
  }

  // Kahn's topological order so predecessors are forecast before successors.
  const queue = [...byUid.keys()].filter((uid) => indegree.get(uid) === 0);
  const order: number[] = [];
  while (queue.length) {
    const uid = queue.shift()!;
    order.push(uid);
    for (const e of outgoing.get(uid) ?? []) {
      const d = indegree.get(e.succ)! - 1;
      indegree.set(e.succ, d);
      if (d === 0) queue.push(e.succ);
    }
  }
  // Cycle guard: malformed data can loop; members fall back to planned dates unpushed.
  const ordered = new Set(order);
  const inCycle = new Set([...byUid.keys()].filter((uid) => !ordered.has(uid)));
  for (const uid of inCycle) order.push(uid);

  const out = new Map<number, ActivityForecast>();
  for (const uid of order) {
    const a = byUid.get(uid)!;
    const p = input.progressByKey.get(a.canonicalActivityKey) ?? baselineProgress(a);
    out.set(uid, forecastOne(a, p, incoming.get(uid) ?? [], out, input.statusDate, inCycle.has(uid)));
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/forecast/computeForecast.test.ts tests/lookahead`
Expected: PASS — new suite green and the existing lookahead suite unaffected by the `baselineProgress` widening.

- [ ] **Step 5: Commit**

```bash
git add lib/forecast/computeForecast.ts lib/lookahead/computeLookahead.ts tests/forecast/computeForecast.test.ts
git commit -m "feat(forecast): status-rule forward pass with never-earlier-than-planned clamp"
```

---

### Task 3: Relationship pushes — FS/SS chains, lag, pushedBy, cycles

**Files:**
- Modify: `tests/forecast/computeForecast.test.ts` (append a describe block; Task 2's implementation already handles edges — these tests prove the semantics against chain fixtures)
- Modify (only if a test exposes a defect): `lib/forecast/computeForecast.ts`

**Interfaces:**
- Consumes: `computeForecast` plus the exported `fa` / `prog` helpers from Task 2's test file.
- Produces: verified push semantics later phases quote in UI copy ("pushed by X (+3d)").

Shared fixture: A (uid 1) planned Mon Aug 3 08:00 – Fri Aug 7 17:00, 5d. B (uid 2) planned Mon Aug 10 08:00 – Fri Aug 14 17:00, 5d. When A is 20% done at statusDate Fri Aug 7, A forecasts +4d (finish Thu Aug 13). An FS successor then starts the next working date (Fri Aug 14) — a 4-working-day push, so B drifts +4d too: **slip propagates undiminished**.

- [ ] **Step 1: Write the chain-fixture tests**

Append to `tests/forecast/computeForecast.test.ts`:

```ts
import type { ForecastRelationship } from "@/lib/forecast/computeForecast";

const rel = (pred: number, succ: number, type = "FS", lagMinutes: number | null = 0): ForecastRelationship =>
  ({ predecessorExternalUid: pred, successorExternalUid: succ, type, lagMinutes });

const lateStatus = new Date("2026-08-07T17:00:00Z");
const chain = () => [
  fa({ externalUid: 1, canonicalActivityKey: "1|a" }),
  fa({
    externalUid: 2, canonicalActivityKey: "2|b",
    plannedStart: new Date("2026-08-10T08:00:00Z"),
    plannedFinish: new Date("2026-08-14T17:00:00Z"),
  }),
];

describe("computeForecast relationship pushes", () => {
  it("a predecessor slip pushes an FS successor by the same working days", () => {
    const p = prog("1|a", { status: "in_progress", percentComplete: 20 }); // A: +4d, finish Thu Aug 13
    const out = computeForecast({
      activities: chain(), relationships: [rel(1, 2)], progressByKey: p, statusDate: lateStatus,
    });
    const b = out.get(2)!;
    expect(b.expectedStart!.toISOString()).toBe("2026-08-14T08:00:00.000Z");  // next working date, planned time kept
    expect(b.expectedFinish!.toISOString()).toBe("2026-08-20T17:00:00.000Z"); // planned finish + 4 working days
    expect(b.driftDays).toBe(4);
    expect(b.pushedByUid).toBe(1);
  });

  it("an on-plan predecessor does not push", () => {
    const out = computeForecast({
      activities: chain(), relationships: [rel(1, 2)], progressByKey: new Map(), statusDate,
    });
    expect(out.get(2)!.driftDays).toBe(0);
    expect(out.get(2)!.pushedByUid).toBeNull();
  });

  it("an early-finishing predecessor never pulls a successor earlier than planned", () => {
    const p = prog("1|a", {
      status: "complete",
      actualStart: new Date("2026-08-03T08:00:00Z"),
      actualFinish: new Date("2026-08-04T17:00:00Z"), // 3 days early
      percentComplete: 100,
    });
    const out = computeForecast({ activities: chain(), relationships: [rel(1, 2)], progressByKey: p, statusDate });
    expect(out.get(2)!.expectedStart!.toISOString()).toBe("2026-08-10T08:00:00.000Z");
  });

  it("FS lag is honored in working days via minutesPerDay", () => {
    // A completes Mon Aug 10 (1 day late); lag 960 min = 2 days at 480 mpd →
    // earliest B start = next working date (Tue) + 2 = Thu Aug 13 → 3-day push.
    const p = prog("1|a", {
      status: "complete",
      actualStart: new Date("2026-08-03T08:00:00Z"),
      actualFinish: new Date("2026-08-10T17:00:00Z"),
      percentComplete: 100,
    });
    const out = computeForecast({
      activities: chain(), relationships: [rel(1, 2, "FS", 960)], progressByKey: p,
      statusDate, minutesPerDay: 480,
    });
    expect(out.get(2)!.expectedStart!.toISOString()).toBe("2026-08-13T08:00:00.000Z");
    expect(out.get(2)!.driftDays).toBe(3);
  });

  it("SS ties starts through a chain and attributes the push", () => {
    // C slips +4d (FS) into A; B is SS-tied to A so B's start moves with A's.
    const acts = [
      fa({ externalUid: 3, canonicalActivityKey: "3|c" }), // C: Mon Aug 3 – Fri Aug 7
      fa({
        externalUid: 1, canonicalActivityKey: "1|a",
        plannedStart: new Date("2026-08-10T08:00:00Z"),
        plannedFinish: new Date("2026-08-14T17:00:00Z"),
      }),
      fa({
        externalUid: 2, canonicalActivityKey: "2|b",
        plannedStart: new Date("2026-08-10T08:00:00Z"),
        plannedFinish: new Date("2026-08-12T17:00:00Z"),
        durationDays: 3,
      }),
    ];
    const p = prog("3|c", { status: "in_progress", percentComplete: 20 });
    const out = computeForecast({
      activities: acts, relationships: [rel(3, 1, "FS"), rel(1, 2, "SS")], progressByKey: p,
      statusDate: lateStatus,
    });
    expect(out.get(2)!.expectedStart!.getTime()).toBe(out.get(1)!.expectedStart!.getTime());
    expect(out.get(2)!.pushedByUid).toBe(1);
  });

  it("a started successor is never pushed (out-of-sequence)", () => {
    const p = new Map([
      ...prog("1|a", { status: "in_progress", percentComplete: 20 }),
      ...prog("2|b", { status: "in_progress", percentComplete: 50, actualStart: new Date("2026-08-05T08:00:00Z") }),
    ]);
    const out = computeForecast({
      activities: chain(), relationships: [rel(1, 2)], progressByKey: p, statusDate: lateStatus,
    });
    expect(out.get(2)!.expectedStart!.toISOString()).toBe("2026-08-05T08:00:00.000Z");
    expect(out.get(2)!.pushedByUid).toBeNull();
  });

  it("FF and SF edges do not push in v1", () => {
    const p = prog("1|a", { status: "in_progress", percentComplete: 20 });
    const out = computeForecast({
      activities: chain(), relationships: [rel(1, 2, "FF")], progressByKey: p, statusDate: lateStatus,
    });
    expect(out.get(2)!.driftDays).toBe(0);
  });

  it("drift propagates undiminished through a multi-hop chain", () => {
    const acts = [
      ...chain(),
      fa({
        externalUid: 3, canonicalActivityKey: "3|c",
        plannedStart: new Date("2026-08-17T08:00:00Z"),
        plannedFinish: new Date("2026-08-21T17:00:00Z"),
      }),
    ];
    const p = prog("1|a", { status: "in_progress", percentComplete: 20 });
    const out = computeForecast({
      activities: acts, relationships: [rel(1, 2), rel(2, 3)], progressByKey: p, statusDate: lateStatus,
    });
    expect(out.get(3)!.driftDays).toBe(4);
    expect(out.get(3)!.pushedByUid).toBe(2);
  });

  it("a relationship cycle does not hang and members fall back to planned dates", () => {
    const out = computeForecast({
      activities: chain(), relationships: [rel(1, 2), rel(2, 1)], progressByKey: new Map(), statusDate,
    });
    expect(out.get(1)!.driftDays).toBe(0);
    expect(out.get(2)!.driftDays).toBe(0);
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `npx vitest run tests/forecast/computeForecast.test.ts`
Expected: PASS if Task 2's implementation is correct. Any failure here is a semantics bug — fix `computeForecast.ts` minimally until green (do not weaken a test to pass; these encode the approved spec).

- [ ] **Step 3: Commit**

```bash
git add tests/forecast/computeForecast.test.ts lib/forecast/computeForecast.ts
git commit -m "test(forecast): chain fixtures pin FS/SS push, lag, out-of-sequence, and cycle semantics"
```

---

### Task 4: Project-level drift

**Files:**
- Modify: `lib/forecast/computeForecast.ts` (append)
- Modify: `tests/forecast/computeForecast.test.ts` (append)

**Interfaces:**
- Consumes: `computeForecast` output, `baselineProgress`.
- Produces:

```ts
export interface ProjectDrift {
  driftDays: number;
  activityUid: number | null; // the latest-finishing incomplete activity, for "driven by X" UI copy
}
export function projectDrift(
  activities: ForecastActivity[],
  forecasts: Map<number, ActivityForecast>,
  progressByKey: Map<string, ActivityProgress>,
): ProjectDrift;
```

- [ ] **Step 1: Write the failing tests**

Append to `tests/forecast/computeForecast.test.ts` (add `projectDrift` to the existing import from `@/lib/forecast/computeForecast`):

```ts
describe("projectDrift", () => {
  it("is the drift of the latest-finishing incomplete activity", () => {
    const acts = chain();
    const p = prog("1|a", { status: "in_progress", percentComplete: 20 });
    const out = computeForecast({ activities: acts, relationships: [rel(1, 2)], progressByKey: p, statusDate: lateStatus });
    expect(projectDrift(acts, out, p)).toEqual({ driftDays: 4, activityUid: 2 });
  });

  it("ignores completed activities even when they finished latest", () => {
    const acts = [
      fa({ externalUid: 1, canonicalActivityKey: "1|a" }),
      fa({
        externalUid: 2, canonicalActivityKey: "2|b",
        plannedStart: new Date("2026-07-06T08:00:00Z"),
        plannedFinish: new Date("2026-07-10T17:00:00Z"),
      }),
    ];
    const p = prog("1|a", {
      status: "complete",
      actualStart: new Date("2026-08-03T08:00:00Z"),
      actualFinish: new Date("2026-08-20T17:00:00Z"), // way late, but done
      percentComplete: 100,
    });
    const pd = projectDrift(acts, computeForecast({ activities: acts, relationships: [], progressByKey: p, statusDate }), p);
    expect(pd.activityUid).toBe(2);
    expect(pd.driftDays).toBe(0);
  });

  it("is zero with no incomplete activities", () => {
    const acts = [fa({ externalUid: 1, canonicalActivityKey: "1|a", actualFinish: new Date("2026-08-07T17:00:00Z"), percentComplete: 100 })];
    const pd = projectDrift(acts, computeForecast({ activities: acts, relationships: [], progressByKey: new Map(), statusDate }), new Map());
    expect(pd).toEqual({ driftDays: 0, activityUid: null });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/forecast/computeForecast.test.ts`
Expected: FAIL — `projectDrift` is not exported.

- [ ] **Step 3: Implement**

Append to `lib/forecast/computeForecast.ts`:

```ts
export interface ProjectDrift {
  driftDays: number;
  activityUid: number | null;
}

/** Spec: project drift = drift of the latest-finishing incomplete activity. */
export function projectDrift(
  activities: ForecastActivity[],
  forecasts: Map<number, ActivityForecast>,
  progressByKey: Map<string, ActivityProgress>,
): ProjectDrift {
  let latest: { uid: number; finish: Date; drift: number } | null = null;
  for (const a of activities) {
    if (!isLeaf(a)) continue;
    const p = progressByKey.get(a.canonicalActivityKey) ?? baselineProgress(a);
    if (p.status === "complete") continue;
    const f = forecasts.get(a.externalUid);
    if (!f?.expectedFinish) continue;
    if (!latest || f.expectedFinish > latest.finish) {
      latest = { uid: a.externalUid, finish: f.expectedFinish, drift: f.driftDays };
    }
  }
  return latest ? { driftDays: latest.drift, activityUid: latest.uid } : { driftDays: 0, activityUid: null };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/forecast/computeForecast.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/forecast/computeForecast.ts tests/forecast/computeForecast.test.ts
git commit -m "feat(forecast): project drift from the latest-finishing incomplete activity"
```

---

### Task 5: Server-side loader — the one shared entry point

**Files:**
- Create: `lib/forecast/getProjectForecast.ts`
- Test: `tests/forecast/getProjectForecast.test.ts` (DB-gated)

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`; `getFinalizedEntries` from `@/lib/updates/updateService`; `resolveCurrentProgress` from `@/lib/lookahead/currentProgress`; Task 2/4 exports.
- Produces (phases 2–4 and the OS context packet call exactly this):

```ts
export interface ProjectForecast {
  forecastsByUid: Map<number, ActivityForecast>;
  project: ProjectDrift;
  statusDate: Date;
}
export async function getProjectForecast(projectId: string): Promise<ProjectForecast | null>; // null when no import exists
```

- [ ] **Step 1: Write the failing test (DB-gated, following `tests/updates/updateService.test.ts`)**

```ts
// tests/forecast/getProjectForecast.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getProjectForecast } from "@/lib/forecast/getProjectForecast";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("getProjectForecast", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("returns null with no import, and forecasts a pushed chain from real rows", async () => {
    const project = await prisma.project.create({ data: { name: "Forecast Loader Test" } });
    projectId = project.id;
    expect(await getProjectForecast(project.id)).toBeNull();

    const imp = await prisma.scheduleImport.create({
      data: {
        projectId: project.id, sourceFormat: "msproject_xml", fileName: "f.xml", fileHash: "h",
        statusDate: new Date("2026-08-07T17:00:00Z"), minutesPerDay: 480,
      },
    });
    // A: Mon Aug 3 – Fri Aug 7, 5d, 20% in progress. B: Mon Aug 10 – Fri Aug 14, 5d, FS after A.
    await prisma.activity.createMany({
      data: [
        {
          scheduleImportId: imp.id, externalUid: 1, canonicalActivityKey: "1|a", name: "A", type: "task",
          plannedStart: new Date("2026-08-03T08:00:00Z"), plannedFinish: new Date("2026-08-07T17:00:00Z"),
          durationDays: 5, percentComplete: 20, actualStart: new Date("2026-08-03T08:00:00Z"),
        },
        {
          scheduleImportId: imp.id, externalUid: 2, canonicalActivityKey: "2|b", name: "B", type: "task",
          plannedStart: new Date("2026-08-10T08:00:00Z"), plannedFinish: new Date("2026-08-14T17:00:00Z"),
          durationDays: 5,
        },
      ],
    });
    await prisma.relationship.create({
      data: { scheduleImportId: imp.id, predecessorExternalUid: 1, successorExternalUid: 2, type: "FS", lagMinutes: 0 },
    });

    const result = await getProjectForecast(project.id);
    expect(result).not.toBeNull();
    // A seeds in-progress from imported actuals: 20% at the Aug 7 status date → +4d; B pushed +4d.
    expect(result!.forecastsByUid.get(1)!.driftDays).toBe(4);
    expect(result!.forecastsByUid.get(2)!.driftDays).toBe(4);
    expect(result!.forecastsByUid.get(2)!.pushedByUid).toBe(1);
    expect(result!.project).toEqual({ driftDays: 4, activityUid: 2 });
    expect(result!.statusDate.toISOString()).toBe("2026-08-07T17:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/forecast/getProjectForecast.test.ts`
Expected: FAIL when `DATABASE_URL` is set (module missing); auto-skips without it — if you have no DB locally, note that and rely on the typecheck in step 4.

- [ ] **Step 3: Implement**

```ts
// lib/forecast/getProjectForecast.ts
import { prisma } from "@/lib/db";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import {
  computeForecast,
  projectDrift,
  type ActivityForecast,
  type ProjectDrift,
} from "./computeForecast";

export interface ProjectForecast {
  forecastsByUid: Map<number, ActivityForecast>;
  project: ProjectDrift;
  statusDate: Date;
}

/**
 * The one shared forecast entry point (spec §1): schedule body, buckets, stat
 * strip, OS context packet, and the lookahead PDF all read these numbers.
 * Status date preference: latest finalized update's as-of date, else the
 * import's status date, else the import timestamp.
 */
export async function getProjectForecast(projectId: string): Promise<ProjectForecast | null> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true, relationships: true },
  });
  if (!latest) return null;

  const progressByKey = resolveCurrentProgress(await getFinalizedEntries(projectId));
  const latestUpdate = await prisma.progressUpdate.findFirst({
    where: { projectId, state: "finalized" },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });
  const statusDate = latestUpdate?.asOfDate ?? latest.statusDate ?? latest.importedAt;

  const forecastsByUid = computeForecast({
    activities: latest.activities,
    relationships: latest.relationships,
    progressByKey,
    statusDate,
    minutesPerDay: latest.minutesPerDay,
  });
  return {
    forecastsByUid,
    project: projectDrift(latest.activities, forecastsByUid, progressByKey),
    statusDate,
  };
}
```

(Prisma's `Activity` and `Relationship` rows structurally satisfy `ForecastActivity` / `ForecastRelationship` — no mapping layer.)

- [ ] **Step 4: Full verification**

Run: `npx vitest run tests/forecast && npm run build && npm test`
Expected: forecast suites PASS (loader test runs only with `DATABASE_URL`), build clean, full suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/forecast/getProjectForecast.ts tests/forecast/getProjectForecast.test.ts
git commit -m "feat(forecast): shared project forecast loader for every later redesign phase"
```

---

## Not in this phase (deliberate)

- No UI reads the forecast yet — phase 2 (shell/stat strip) is the first consumer.
- No caching: the pass is O(activities + relationships); add a per-(import, latest update) cache only if a real page measures slow.
- A not-started activity whose planned start is already past the status date is **not** clamped forward to the status date — the spec's rule list doesn't include it, and the lookahead's "should-have-started" flag covers awareness. Candidate v2 rule; noted here so it isn't rediscovered as a bug.
- FF/SF push semantics, holiday calendars, working-time lag arithmetic, pulling early — all out of scope per spec.
