# Schedule Management Tool — Slice 5d Design Spec (Schedule-Health / Date-Sanity)

**Date:** 2026-06-20
**Status:** Design approved; ready for implementation
**Owner:** Skiles Group (AJ Woodyard)
**Location:** `/home/coder/projects/Skilesconnect/schedulemanagement`
**Builds on:** Slice 1 (import + canonical model). Independent sub-slice of roadmap Slice 5.

---

## 1. Context

Imported MS Project schedules occasionally carry **implausible dates** — the canonical
case is an activity mis-dated to the wrong year (the "2025 mis-date catch" in a 2026
project). These slip through import silently and corrupt lookaheads, exports, and
progress tracking. Slice 5d adds a **read-only schedule-health screen** that flags
suspect activities so a scheduler can spot and fix them upstream in MS Project.

This is the cleanest slice on the roadmap: **independent (depends only on Slice 1),
no schema change, no migration, no dictionary/learning loop.** Unlike 5a/5b it is a
pure read-time overlay — it never mutates the immutable import snapshots.

**Deterministic, no AI** (per `CLAUDE.md` "Don't Build Yet").

---

## 2. Slice Goal

Load the latest import's activities, run deterministic **date-sanity checks**, and
display flagged activities with a clear message per issue. No writes, no acknowledgement
state — surfacing the problem is the deliverable; fixes happen upstream in MS Project.

---

## 3. Product Decisions (confirmed)

| Decision | Choice |
|----------|--------|
| Checks (v1) | **Out-of-envelope dates**, **future actuals**, **missing-dates / 100%-contradictions**. Reversed-date (finish < start) deferred to v2. |
| Out-of-envelope range | **Stored envelope + derived fallback.** Use import `projectStart`/`projectFinish` (+ buffer) when present; else derive an outlier-robust window from the activity planned-date distribution. |
| Anchor date | `statusDate ?? importedAt ?? now` — the data date for the future-actuals check. Mirrors `computeLookahead`'s explicit `asOfDate`. |
| Severity | Out-of-envelope = **error**; future actuals = **error**; missing-dates / contradictions = **warning**. |
| Storage | **None.** Pure read-time computation; no table, no migration, no API route. |
| Surface | Dedicated **Schedule health** page + nav button, mirroring the 5a/5b screens. |

---

## 4. Checks

Run over **leaf + active** activities only (skip `summary`/`project_summary`; skip
`isActive === false`), reusing the filter convention from `computeLookahead`.

1. **Out-of-envelope** (error) — any of `plannedStart`, `plannedFinish`, `actualStart`,
   `actualFinish` falling outside the plausible window. Catches the wrong-year mis-date.
2. **Future actuals** (error) — `actualStart` or `actualFinish` later than `asOfDate`.
   You cannot have completed work after the data date.
3. **Missing dates** (warning) — a leaf task with no `plannedStart` or no `plannedFinish`.
4. **Percent contradictions** (warning) — `percentComplete === 100` with no
   `actualFinish`; or `actualFinish` set with `percentComplete` under 100.

---

## 5. Plausible Window (`computeEnvelope`)

- If `projectStart` **and** `projectFinish` are present on the import, window =
  `[projectStart − buffer, projectFinish + buffer]`.
- Otherwise **derive** from all non-null `plannedStart`/`plannedFinish` across activities:
  sort the timestamps, **trim the extreme ~5% tails** (so a handful of mis-dates cannot
  widen the window and hide themselves), take the trimmed min/max, then apply the buffer.
- **Buffer:** 180 days each side.
- Too few dated activities to derive (< ~8) and no stored envelope → **no envelope
  check** (return a null window; out-of-envelope check is skipped rather than guessing).

Pure and unit-testable: `computeEnvelope(activities, importEnvelope): DateWindow | null`.

---

## 6. Modules

**`lib/health/dateChecks.ts`** (pure):
- Types — `HealthSeverity`, `HealthCheck`, `HealthActivity` (subset of `Activity`),
  `HealthIssue { activityId, externalId, wbsCode, name, check, severity, message, field?,
  value? }`, `DateWindow`.
- `computeEnvelope`, `checkOutOfEnvelope`, `checkFutureActuals`, `checkMissingDates`,
  `checkPercentContradictions`, `runHealthChecks(activities, importEnvelope, asOfDate)`,
  `summarizeHealth(issues)`.

**`lib/health/healthService.ts`** (DB read):
- `getScheduleHealth(projectId)` → `{ hasImport, asOfDate, window, issues, summary }`.
  Loads the latest import + activities (normalize-page pattern), maps to `HealthActivity`,
  calls `runHealthChecks`.

**`app/projects/[id]/health/page.tsx`** — server component; summary line + data date +
`HealthIssuesTable`; empty-import guard.

**`components/HealthIssuesTable.tsx`** — client; search + severity/check filter; severity
badges (red error / amber warning); read-only list (ActivityTable styling).

**`app/projects/[id]/page.tsx`** — add a "Schedule health" nav link.

---

## 7. Telemetry Profile

**Explicit opt-out**, consistent with Slices 1–3 (no manifest/telemetry infrastructure).
Revisit trigger: Connect integration or a telemetry system landing.

---

## 8. Testing

- **Unit** (`tests/health/dateChecks.test.ts`, no DB): each check in isolation; the **2025
  mis-date** scenario flags out-of-envelope while the surrounding schedule does not;
  derived envelope stays robust with a single outlier; future-actual fires only past
  `asOfDate`; missing-dates and contradiction edges; empty input → no issues; too-few
  dates → no envelope check.
- **DB-gated** (`tests/health/healthService.test.ts`, 30000ms, self-cleaning): project +
  import + activities (one mis-dated, one future-actual, one healthy) → asserts the issue
  set and summary counts.
- **Build** — health page + table compile.
- **Smoke (manual)** — open a project → Schedule health → mis-dated activity flagged with
  a clear message; a clean schedule shows "No date issues found".

---

## 9. Non-Goals (v1)

- Reversed-date check (finish < start) — v2 candidate.
- Any auto-fix / mutation of imports (read-only by design).
- Persisting or dismissing/acknowledging issues (no table).
- Cross-import or baseline-vs-current drift analysis.
- Any LLM/AI.

---

## 10. Dependencies & Compatibility

- **Depends on:** Slice 1 (`Activity` date fields, `ScheduleImport` envelope/status date).
- **Reuses:** leaf+active filter (`lib/lookahead/computeLookahead.ts`), latest-import load
  (`app/projects/[id]/normalize/page.tsx`), read-only table patterns
  (`components/ActivityTable.tsx`), DB-gated test convention.
- **Schema change:** none.
