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

`benchmarkEligible = noPredecessorPct <= 10% && noSuccessorPct <= 50% && hard_constraints, negative_float and high_duration all pass`. Loosened twice: first from strict DCMA missing logic (all 5 cath files failed it), then from a 60%-of-checks floor (2020 pilot: only 16 of 27 projects usable; lags, leads, non-FS, float and out-of-sequence are style or side effects of loose ends). Decided 2026-10-22. The full DCMA score still shows on Schedule Health.

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

## Phase 2 — Raw file storage ✅ (PR #40)

- Original XML goes to a private S3 bucket (`imports/<projectId>/<fileHash>.xml`) before the snapshot is saved. `ScheduleImport.sourceObjectKey` is an additive migration. Server-only reads; no signed URLs until a download button is wanted.
- Export uses the stored original. Only imports from before this change ask for a re-upload.

## Scale decisions (2026-10-22, Q42–Q46)

2020 alone is 200+ files, mostly incremental saves; 2020–2026 will be 1000+.

- **Keep only key versions per project:** the earliest, the latest, and one per month in between. Skipped files stay listed in the manifest.
- **Benchmarks count projects, not files:** actuals from the latest eligible import, planned durations from the earliest.
- **Local manifest step before any import** (replaces the hand-made project map). It runs on the user's machine, outside the app:
  1. MPXJ batch-converts `.mpp` → MSPDI XML (needs Java). This supersedes the manual Save As.
  2. A script writes one CSV row per file: hash (dupes), title from file, file-name date, activity count, date range, proposed project group, keep/skip.
  3. Local model (see the `delegating-to-local-model` skill) proposes groupings for mismatched titles and guesses project metadata (building type, client, sector) into the CSV. Claude reviews the summary and low-confidence rows, not raw files.
  4. Admins correct the CSV. The backfill imports only `keep` rows.
- Activity-name → scope mappings are reviewed in the app in Phase 4, without a local model (Q63).

## Phase 3 — Manifest + backfill script + pilot

- `scripts/manifest.ts` and the MPXJ conversion step, as above.
- `scripts/backfill.ts` (tsx) reads the corrected manifest, creates or looks up projects, and calls `commitImport` for each `keep` row, skipping duplicate hashes. It is resumable, and prints tier, score and reasons per file (`getImportQuality`).
- Pilot on 2020 first (200+ files), then calibrate the Phase 1 constants with an admin.
- Delete the scripts after Phase 6.

## Phase 4 — Review queues + admin metadata/grouping table

Phases 1–3 are merged (#39, #40, #41, plus #42 for the logic tier on Data Health); the task checkboxes above predate that. Phase 4 decisions, 2026-10-23:

- **Historical library (Q51):** backfilled projects (`status = historical`, `externalProjectKey = backfill:FY<year>:<name>` — projects live only in the fiscal year they were created, so the same name in two years is two projects) live in a **separate, read-only area**: `/history` (list, filter by FY, sector, project type) and `/history/[id]` (details, each import with tier and reasons). They're off the live project list; `/projects/<id>` redirects to the library page; every project-scoped API route refuses them (`denyIfHistorical` in `lib/historical.ts`), so no edits, updates or export.
- **Who (Q55):** standalone sessions and OS-launched tool admins. Other OS-launched sessions stay locked to their project. Only admins edit details or tier overrides.
- **No tier filter on the list (Q56):** tiers are computed at read time (Phase 1); doing all 1,109 imports on one page load is too slow. Tiers show on each project page. Revisit only if tiers get stored.
- **Details (Q57):** sector and project type use Skiles' standard lists from Fibery (Database Standards/Project Type: 6 market sectors, 32 project types). Each type belongs to one sector, so the sector follows from the type (`PROJECT_TYPES` in `lib/historical.ts`; stored in `Project.sector` / `Project.buildingType`). Size is optional. Contract value stays out of the scheduling tool. Pre-filled from a reviewed `<year>-projects.csv` that `scripts/backfill.ts` applies (blank cells leave values alone).
- **Tier override (Q58):** admins set automatic, rough or junk; as-built and baseline must come from the data.
- **Order (Q59):** PR 1 (library + details), then the production backfill (Phase 6, run by the user), then PR 2 (name review) against production data, then split mining, then agent access.
- **Agent access to history (Q52, revised):** (1) read-only Schedule Manager endpoints exposed as tools by **Connect's existing MCP server**, not a standalone MCP server here; (2) **read-only `history_*` DB views** behind a read-only role (role SQL run by the user in the Neon console). History stays read-only through both.
- **Standard names (Q60):** the existing standard list is the set of `canonicalScope` values in `ScopeDictionaryEntry` (plus each scope's own name). No new list is drafted.
- **Name review (Q61–Q63):** an admin page `/history/names` lists names the standard list doesn't cover, from historical **and** live projects, ranked by how many projects use them (default 3+, adjustable). Each row shows samples and the closest existing scope from `suggestScopes.ts`. Actions: approve the suggestion, pick another, add as a new standard scope, or ignore (a small table keeps ignored names hidden). The admin action is the approval. **No local model**, now or later.
- **Split-rule mining:** WBS parent→children patterns, matched against the existing `ScopeSplitRule`s first; only novel ones get queued. Details decided before that PR.
- **Sub identity (Q64):** deferred; nothing in Phases 5–7 uses it.

## Phase 5 — Benchmarks + surfacing

- `lib/benchmarks/` pure aggregation, **one contribution per project** (latest eligible import for actuals, earliest for planned): span per canonical scope; median, P25 and P75, blended by buildingType and sector (below). It filters out `isSynthetic`, imports that aren't benchmark-eligible, and actuals from unfinished scopes. Computed at read time, like Phase 1.
- **Bayesian blending (Q54, 2026-10-23)** replaces the hard "n ≥ 5 by buildingType, else sector" switch. Each statistic is shrunk toward the sector's value in proportion to how little buildingType data there is (empirical Bayes):

  ```
  blended = (n × buildingType value + k × sector value) / (n + k)
  ```

  `n` = projects of that buildingType contributing to the scope; `k` = prior strength, start at 5 (a buildingType with 5 projects counts half). Applied to median, P25 and P75 alike. The sector value still needs n ≥ 5; below that the scope has no benchmark. Plain arithmetic — no stats library. Show `n` and the blend share beside every range so a thin number is visibly thin. Tune `k` against the full backfill.
- Also store sequencing-pair, criticality-frequency and milestone-gap aggregates here (spec Q17 #3–5).
- **Surfacing:** a range beside the duration in `ActivityDetail`, a new Data Health check (duration outside historical range), and a "usually critical" marker.

## Phase 6 — Full FY2020–2026 backfill

- The Phase 3 script on the full set, with the admin review queues worked in batches. Delete `scripts/backfill.ts` afterwards.

## Phase 7 — Draft baseline generator

- Inputs: building type, SF, start date, scope checklist.
- Durations come from the Phase 5 blended statistics, so a thin buildingType leans on its sector instead of failing.
- Assembly from statistics: links that appear in ≥ 50% of the projects containing both scopes; cycle break; open-end tie-off; P75 durations.
- Hard error when there are fewer than 5 qualifying projects; warnings on thin scopes and links; confidence summary.
- Output: a synthetic import with lineage, exported through the existing `lib/export`.
