# Historical Schedule Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-10-22-historical-schedule-backfill-and-baselines.md`

**Shape:** Seven phases, in spec build order. **Phase 1 is detailed task-by-task below.** Phases 2–7 are scoped with files and decisions, and each gets its own task-level plan when it starts, because the Phase 3 pilot is where Phase 1's thresholds get calibrated and later phases depend on what the pilot shows.

## Deviation from spec (decided while planning)

The spec says the logic score is "stored per import." **It is computed at read time instead**, matching the existing contract in `lib/health/dateChecks.ts` ("Computed entirely at read time — imports are never mutated"). Imports stay immutable, thresholds can be re-tuned after the pilot with no migration or backfill, and at ~200 projects computing on the fly is cheap. The one thing that *must* be stored is the admin's tier override, and that waits for Phase 4 (admin table).

## Global Constraints

- TypeScript strict; never `any`. No `console.log` server-side. **No new dependencies in Phase 1.**
- Pure functions in `lib/health/*` take plain input types (like `HealthActivity`) and have no DB access. Prisma lives only in `lib/health/healthService.ts`.
- Durations are working days = minutes ÷ `minutesPerDay` (`minutesToDays` in `lib/msp/duration.ts`; default 480 when null, same as `scheduleContextPacket.ts`).
- Checks run over `isLeafActive` activities, excluding milestones only where a metric says so.
- Every threshold is a named exported constant in one block at the top of `logicChecks.ts`, with a `ponytail:` comment saying it is calibrated in the Phase 3 pilot.
- DB-backed tests use `describe.runIf(!!process.env.DATABASE_URL)` and delete their project in `afterAll`, matching `tests/health/healthService.test.ts`. Run them on local docker Postgres, not Neon.
- Branch `feat/logic-score-tiering` off `master`, one commit per task, PR at the end. `npm run build` and `npm test` before opening it.
- Preserve: the date checks, Data Health tab badge, import path, export, and OS packet are untouched apart from the additions listed.

---

## Phase 1 — Logic quality score + import tier

### Task 1: Logic metrics (pure) ✅

**Files:**
- Create: `lib/health/logicChecks.ts`
- Test: `tests/health/logicChecks.test.ts`

**Interfaces (Tasks 2–4 consume exactly these):**

```ts
export interface LogicActivity {
  externalUid: number;
  type: string; isActive: boolean; isMilestone: boolean;
  durationMinutes: number | null;
  totalSlackMinutes: number | null;
  constraintType: number | null;      // MSPDI: 2 MSO, 3 MFO, 5 SNLT, 7 FNLT are "hard"
  actualStart: Date | null; actualFinish: Date | null;
}
export interface LogicRelationship {
  predecessorExternalUid: number; successorExternalUid: number;
  type: string; lagMinutes: number | null;   // string, as Prisma returns it
}
export type LogicMetricKey =
  | "missing_logic" | "leads" | "lags" | "non_fs" | "hard_constraints"
  | "high_float" | "negative_float" | "high_duration" | "out_of_sequence";
export interface LogicMetric { key: LogicMetricKey; count: number; denominator: number; pct: number; threshold: number; pass: boolean }
export interface LogicScore { metrics: LogicMetric[]; passed: number; total: number; score: number /* 0..1 */; benchmarkEligible: boolean }
export function scoreLogic(activities: LogicActivity[], relationships: LogicRelationship[], minutesPerDay: number): LogicScore;
```

**Metrics.** The denominator is leaf-active activities unless stated otherwise. Thresholds follow DCMA defaults.

| Key | Counts | Threshold |
|---|---|---|
| `missing_logic` | leaves with no predecessor **or** no successor (relationships to non-leaf UIDs ignored; one open start (pred-less) and one open finish (succ-less) leaf are exempt as the network's ends) | ≤ 5% |
| `leads` | relationships with `lagMinutes < 0` (denominator = relationships) | 0 |
| `lags` | relationships with `lagMinutes > 0` | ≤ 5% |
| `non_fs` | relationships whose type isn't FS | ≤ 10% |
| `hard_constraints` | `constraintType ∈ {2,3,5,7}` | ≤ 5% |
| `high_float` | total slack > 44 working days | ≤ 5% |
| `negative_float` | total slack < 0 | 0 |
| `high_duration` | non-milestone with duration > 44 working days | ≤ 5% |
| `out_of_sequence` | FS relationships where the successor has an actual start and the predecessor has no actual finish, or finished after it | ≤ 5% (denominator = FS relationships with a started successor; if that is 0, the metric passes and is excluded from `total`) |

`benchmarkEligible = noPredecessorPct <= 10% && noSuccessorPct <= 50% && score >= 0.6` (loosened from strict DCMA missing logic after the first 5 pilot files all failed it; decided 2026-10-22). Missing successors are omissions, so existing links still feed sequencing; missing predecessors usually mean typed-in dates. Eligible files feed durations, names and sequencing. The strict DCMA metric still shows on Schedule Health.

- [ ] **Step 1: Write failing tests.** Build tiny fixtures with `act()`/`rel()` helpers, as in `dateChecks.test.ts`:
  - a clean 5-activity FS chain → every metric passes, score 1, eligible
  - an orphan in the middle → `missing_logic` fails, not eligible even if every other metric passes
  - the chain's first and last activities are not counted as missing logic
  - one negative lag → `leads` fails
  - MSO constraint on 1 of 10 → `hard_constraints` fails (10% > 5%)
  - slack/duration conversion respects `minutesPerDay` (45 days at 480 fails, the same minutes at 600 passes)
  - a successor with an actual start but an unfinished predecessor → `out_of_sequence` counts it
  - no started successors → `out_of_sequence` is excluded from `total`
  - summaries and inactive activities are ignored everywhere
- [ ] **Step 2: Implement** to green. One pass to build predecessor/successor sets keyed by UID; each metric is a small function.
- [ ] **Step 3: Commit** `feat(health): DCMA-style logic quality score`

### Task 2: Import tier (pure)

**Files:**
- Create: `lib/health/importTier.ts`
- Test: `tests/health/importTier.test.ts`

```ts
export type ImportTier = "as_built" | "baseline" | "rough" | "junk";
export interface TierInput {
  leafCount: number;
  relationshipCount: number;
  leavesWithActuals: number;   // actualStart or actualFinish set
  logic: LogicScore;
}
export function classifyImport(input: TierInput): { tier: ImportTier; reasons: string[] };
```

Rules, evaluated in order (constants at the top of the file, marked `ponytail:` for calibration):
1. `leafCount < MIN_LEAVES` (10) → **junk**
2. `!logic.benchmarkEligible` or `relationshipCount / leafCount < MIN_LINKS_PER_LEAF` (0.8) → **rough**
3. `leavesWithActuals / leafCount >= MIN_ACTUALS_SHARE` (0.1) → **as_built** (status date ignored — too spotty in MSP files; decided 2026-10-22)
4. otherwise → **baseline**

`reasons` are plain sentences for the UI and the backfill report (e.g. "Only 42% of activities have both a predecessor and successor").

- [ ] **Step 1: Failing tests:** one test per tier, plus the boundary at each constant.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** `feat(health): classify imports into as-built/baseline/rough/junk tiers`

### Task 3: Wire into health service

**Files:**
- Modify: `lib/health/healthService.ts` (also load `relationships` on the latest import; add `logic: LogicScore | null` and `tier: { tier, reasons } | null` to `ScheduleHealth`, both null when there's no import)
- Test: `tests/health/healthService.test.ts` (add one case: an import with a broken chain returns a failing `missing_logic` and tier `rough`)

Also export one helper used by Phase 3's backfill report, so the script and the UI can't disagree:

```ts
export async function getImportQuality(importId: string): Promise<{ logic: LogicScore; tier: ImportTier; reasons: string[] }>;
```

`getScheduleHealth` calls it for the latest import.

- [ ] **Step 1: Failing DB test.** **Step 2: Implement.** **Step 3: Commit** `feat(health): expose logic score and tier from the health service`

### Task 4: Show it on Schedule Health

**Files:**
- Modify: `app/projects/[id]/health/page.tsx`. Add a "Schedule logic" section after Progress: the tier as a pill with its reasons, `score` as "7 of 9 checks pass", and one line for each failing metric ("Missing logic: 18% (limit 5%)"). Add a note when the import is not benchmark-eligible.
- Test: a component test only if the section is extracted into `components/LogicScoreSection.tsx`. Extract it only if the page grows past roughly 30 lines.

Mobile: a single column, and the pill wraps. No new colors beyond the existing slate/blue/amber.

- [ ] **Step 1: Implement.** **Step 2:** check it by hand on a demo seed project (`npm run demo:seed`). **Step 3: Commit** `feat(health): schedule logic section on Schedule Health`

**Phase 1 done when:** the build and tests are green, and a PR is opened with a screenshot of the section on the demo project.

---

## Phase 2 — Raw file storage + `.mpp` intake

- **Raw XML to private S3** in `commitImport` (key: `imports/<projectId>/<fileHash>.xml`), plus a `sourceObjectKey String?` column on `ScheduleImport` (additive migration, safe to roll back). Downloads go through signed URLs only. Re-export can then read the stored original instead of asking for a re-upload. Reuse the private-bucket/signed-URL pattern from Connect's New Project Intake. Check first whether Schedule Manager's host (Vercel) already has an S3 client configured, and only add `@aws-sdk/client-s3` + `s3-request-presigner` if not.
- **`.mpp`:** no code. Write a one-page admin how-to (open in MS Project → Save As XML). The MPXJ converter is deferred until volume or Primavera XER files show up.

## Phase 3 — Backfill script + pilot (9 cath lab files)

- `scripts/backfill.ts` (tsx). It takes a folder and a project map CSV (`file,projectName`), creates or looks up the project, and calls `commitImport` for each file, skipping duplicate `fileHash`es. It prints a table: file → project, tier, score, failed metrics, reasons (from `getImportQuality`). Use `isBaseline` from `previewImport`'s suggestion.
- Run it on `Schedulecomparisions/` XMLs, after the `.mpp` files are saved as XML and junk files (`hello.*`, `world.txt`, `steam%20engines.md`) are removed.
- **Calibration:** review the table with an admin and adjust the Phase 1 and 2 constants. That's the point of the pilot.
- The script is deleted after Phase 6.

## Phase 4 — Review queues + admin metadata/grouping table

- **Dictionary suggestions:** extend the existing `DictionaryPanel` / `NormalizePanel` flow with a cross-project queue of unmapped names sorted by frequency. Reuse `suggestScopes.ts`. The LLM classifier is added only if the Jaccard match is weak on the pilot names.
- **Split-rule mining:** WBS parent→children patterns matched against the existing `ScopeSplitRule`s first; only novel patterns get queued in `SplitRulesPanel`.
- **Admin project table:** bulk edit of `Project` metadata, prefilled from filename/`rawProjectProps`. Confirm grouping (duplicate hash, then name + date overlap). Tier override: `tierOverride String?` on `ScheduleImport`, an additive migration.
- **Sub identity:** a raw-text capture rule plus a suggested trade-partner match. Shown only, not scored.

## Phase 5 — Benchmarks + surfacing

- `lib/benchmarks/` pure aggregation: span per canonical scope per project; median, P25 and P75; n ≥ 5; split by buildingType, falling back to sector. It filters out `isSynthetic`, imports that aren't benchmark-eligible, and actuals from unfinished scopes. Computed at read time, like Phase 1.
- Also store sequencing-pair, criticality-frequency and milestone-gap aggregates here (spec Q17 #3–5).
- **Surfacing:** a range beside the duration in `ActivityDetail`, a new Data Health check (duration outside historical range), and a "usually critical" marker.

## Phase 6 — Full ~200-file backfill

- The Phase 3 script on the full set, with the admin review queues worked in batches. Delete `scripts/backfill.ts` afterwards.

## Phase 7 — Draft baseline generator

- Inputs: building type, SF, start date, scope checklist.
- Assembly from statistics: links that appear in ≥ 50% of the projects containing both scopes; cycle break; open-end tie-off; P75 durations.
- Hard error when there are fewer than 5 qualifying projects; warnings on thin scopes and links; confidence summary.
- Output: a synthetic import with lineage, exported through the existing `lib/export`.
