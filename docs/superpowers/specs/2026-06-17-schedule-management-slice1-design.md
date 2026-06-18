# Schedule Management Tool — Design Spec

**Date:** 2026-06-17
**Status:** Slice 1 design approved; ready for implementation planning
**Owner:** Skiles Group (AJ Woodyard)
**Location:** `/home/coder/projects/Skilesconnect/schedulemanagement`

---

## 1. Product Vision

A schedule management tool for Skiles Group Connect that makes maintaining an
up-to-date CPM schedule easy enough that it actually happens every week, and
that turns the resulting consistent history into reusable scheduling
intelligence.

### Goals

1. **Simplify baseline CPM updates** so teams keep the schedule current, producing
   valid historical data for future use.
2. **Capture long-term data across projects** to aggregate scheduling information
   and later generate rapid but accurate preliminary schedules.
3. **Increase task-naming consistency and schedule completeness** (all tasks
   tracked) without adding cognitive load — templates adjusted to project
   specifics.
4. **Proactively surface upcoming scopes** so teams prepare in advance (future:
   attach lessons learned and prep notes to intricate scopes well ahead of time).
5. **Understand trade-partner performance and workload** across the organization.

### Adjacent / connected tools (future, out of scope here)

- Weekly Wipe Down Capture
- Procurement tracking

---

## 2. Architecture Decisions

| Decision | Choice | Notes |
|----------|--------|-------|
| Relationship to Connect | **Standalone, integration-ready** | Own app, own DB, own UI. Schema/IDs/event shape designed to later plug into Connect (projects, tasks, activity stream) via shared contracts, but does not depend on Connect to ship. |
| Stack | **Next.js 14 (App Router) + TypeScript + Tailwind** | One framework for mobile-first UI + API route handlers. Matches the existing `weeklyreportbuilder` stack. |
| Database / ORM | **PostgreSQL on Railway + Prisma** | Migrations are the schema source of truth. |
| Auth (Slice 1) | **Simple shared login** | Env-based password → signed cookie via middleware. Per-user accounts deferred to a later slice. |
| First import format | **MS Project XML (MSPDI)** | Avoid binary `.mpp`. Validated against four real Skiles schedule exports. |

### Integration-ready conventions (for eventual Connect linkage)

- Portable IDs (cuid) on all canonical rows; capture source-system IDs separately.
- Dated rows (`createdAt`/`updatedAt`) and immutable import snapshots for history.
- Activity-event-shaped data kept reconstructable, matching Connect's
  `core_activity_events` direction.
- Store not-yet-normalized data as raw JSON so later normalization needs **no
  re-import**.

---

## 3. Roadmap (slice decomposition)

The vision is a platform of independent subsystems. Each slice is its own
spec → plan → build cycle. Order chosen so each slice stands on the prior one.

| # | Slice | Delivers | Depends on |
|---|-------|----------|------------|
| **1** | **Schedule spine** (this spec) | Import MS Project XML → canonical model → verification view | — |
| 2 | **Lookahead + weekly update loop** | 3/6-week lookahead views; simple weekly update form; versioned progress snapshots (the historical-data engine; goal #1) | 1 |
| 3 | **Export back** | Round-trip field updates into the scheduling software | 1, 2 |
| 4 | **Additional importers** | P6 (XER), Phoenix, others → same canonical model | 1 |
| 5 | **Normalization + analytics** | Task-name normalization, trade-partner attribution (inference-assisted, bulk, learns over time), schedule-completeness checking, trade-partner performance/workload, cross-project aggregation for preliminary schedules (goals #2, #3, #5) | 1, 2 (data across projects) |
| 6 | **Proactive reminders + lessons learned** | Surface upcoming scopes ahead of time; attach lessons-learned/prep notes to intricate scopes (goal #4) | 1, 2, 5 |

### Normalization slice (5) — captured intent

Trade partner is **not** stored in the schedule files (confirmed against real
data — see §6). Goals #3 and #5 are solved by one normalization engine:

- Normalize task names against a standard scope dictionary.
- From normalized names, **bulk-attribute** trade partner per activity
  (e.g. "Electrical Rough-In" → Electrical), user confirms/corrects, and the
  dictionary **learns** over time and across projects.
- In the same pass, run a **completeness check**: flag coarse activities that
  should be split into properly tracked scopes (e.g. a single "MEP Rough" that
  should be electrical rough / plumbing rough / mechanical rough), driven by
  project-type-adjusted templates.
- Add a **schedule-health / date-sanity check** alongside completeness: flag
  activities with implausible dates — planned dates before the project start, or
  in the past with no actuals — as their own surfaced check rather than relying
  on a human noticing them in the lookahead. *Motivating example (2026-06): a
  real imported schedule had a future scope of work mis-dated in 2025; Slice 2's
  past-due catch-all happened to surface it, validating the value — but a
  dedicated health check should own this rather than leaning on the lookahead.*

Slice 1 captures all raw inputs (names, WBS, custom fields) so this is buildable
later without re-importing anything.

---

## 4. Slice 1 — Scope

**Goal:** Prove the canonical data model and one trustworthy importer. Import a
MS Project XML file, normalize it into the canonical schedule model at full
fidelity, and present a verification view so a scheduler can confirm the import
matches the source file.

### In scope

- Shared-login gate.
- Projects list + create project with a **minimal profile**.
- MS Project XML import: upload → server parse → **preview before commit** →
  commit writes an immutable snapshot.
- Canonical data model (full fidelity, versioned by import).
- Verification view: mobile-first activity list / table with search, filter,
  sort, group-by-WBS, and detail-on-expand.

### Out of scope (later slices)

Lookahead formatting, update/progress writing, editing activities, export,
trade-partner mapping, name normalization, completeness checking, analytics,
reminders, P6/Phoenix importers, per-user auth, real-time anything.

---

## 5. Canonical Data Model (Prisma)

Format-agnostic, full-fidelity, versioned by import. Each import is an
**immutable snapshot**; re-importing a project creates a new `ScheduleImport`.
"Current" reads = latest import. Cross-version threading is a read-time/later
concern via `canonicalActivityKey` — snapshots are never mutated.

### Project
Minimal profile captured at create / first import.
- `id` (cuid), `name`, `client`, `sector` / `buildingType`, `sizeSqFt`,
  `contractValue`, `region`, `deliveryMethod`, `status`, `createdAt`,
  `updatedAt`
- `externalProjectKey` (nullable) — future Connect linkage
- `externalProjectGuid` (nullable) — MSP project GUID seen on import

### ScheduleImport (snapshot / version)
- `id`, `projectId`, `sourceFormat` (`msproject_xml`), `fileName`, `fileHash`
- `importedAt`, `importedBy` (string for now)
- `projectTitleFromFile`, `statusDate` (nullable → prompted), `isBaseline`
- `projectStart`, `projectFinish`
- `minutesPerDay`, `minutesPerWeek`, `daysPerMonth` (for duration→day conversion)
- `rawProjectPropsJson`, `importFieldDefinitionsJson` (custom-field FieldID→alias map)
- `activityCount`, `relationshipCount`, `resourceCount`
- `warningsJson`, `notes`

### Activity (belongs to a ScheduleImport)
- `id`, `scheduleImportId`
- `externalUid` (MSP UID, stable within file), `externalGuid`, `externalId`
- `wbsCode`, `outlineNumber`, `outlineLevel`, `parentExternalUid`
- `name`, `canonicalActivityKey` (normalize(wbsPath + "|" + name))
- `type` (canonical: task | milestone | summary | project_summary),
  `rawType`, `isMilestone`, `isSummary`, `isProjectSummary`, `isCritical`,
  `isActive`
- `plannedStart`, `plannedFinish`
- `earlyStart`, `earlyFinish`, `lateStart`, `lateFinish` (raw)
- `actualStart`, `actualFinish`
- `baselineStart`, `baselineFinish`, `baselineDurationMinutes`
- `durationMinutes`, `durationDays`, `remainingDurationMinutes`,
  `actualDurationMinutes`
- `percentComplete`, `percentWorkComplete`
- `totalSlackMinutes`, `freeSlackMinutes`
- `constraintType`, `constraintDate`, `deadline`
- `calendarExternalUid`
- `customFieldsJson` (keyed by alias, e.g. `{ "Phoenix ID": "2" }`)
- `rawBaselinesJson` (all baseline numbers if multiple)

Indexes: `projectId`, `scheduleImportId`, `wbsCode`, `externalUid`,
`plannedStart`.

### Relationship (belongs to a ScheduleImport)
- `id`, `scheduleImportId`
- `predecessorExternalUid`, `successorExternalUid`
- `type` (FS | SS | FF | SF), `rawType` (0/1/2/3)
- `lagMinutes`, `rawLagFormat`, `crossProject`

### Resource (belongs to a ScheduleImport)
- `id`, `scheduleImportId`, `externalUid`, `name`, `type` (work|material|cost),
  `group`, `customFieldsJson`

### Assignment (belongs to a ScheduleImport)
- `id`, `scheduleImportId`, `activityExternalUid`, `resourceExternalUid`,
  `units`, `workMinutes`

### Calendar (belongs to a ScheduleImport)
- `id`, `scheduleImportId`, `externalUid`, `name`, `rawJson` (working times,
  captured raw — not computed in Slice 1)

---

## 6. MS Project XML (MSPDI) Parser Spec

Validated against four real Skiles exports
(`BSW Regional Cath IR …`, `… AW v2`, `BSW Regional ED … DRAFT v1/v6`).

### Namespace
Root `<Project xmlns="http://schemas.microsoft.com/project">`. Parser must be
namespace-aware.

### Project header → ScheduleImport
| MSPDI | Canonical |
|-------|-----------|
| `Title` | `projectTitleFromFile` (suggested `Project.name` on first import) |
| `GUID` | `Project.externalProjectGuid` |
| `StatusDate` | `statusDate` (if missing → prompt user) |
| `StartDate` / `FinishDate` | `projectStart` / `projectFinish` |
| `MinutesPerDay` (480) | `minutesPerDay` (duration→day divisor) |
| `MinutesPerWeek`, `DaysPerMonth` | stored |
| `CalendarUID` | default calendar reference |
| `CurrentDate`, others | `rawProjectPropsJson` |

### `<ExtendedAttributes>` → field definition map
Map `FieldID` → `FieldName` → `Alias`
(this file: `Text1` → `"Phoenix ID"`). Stored as
`importFieldDefinitionsJson`; drives the preview's "detected custom fields"
list and lets `Activity.customFieldsJson` be keyed by human alias.

### `<Task>` → Activity
- Skip tasks where `IsNull = 1` (placeholder rows).
- `UID` → `externalUid`; `GUID` → `externalGuid`; `ID` → `externalId`.
- `Name`, `WBS`, `OutlineNumber`, `OutlineLevel`.
- Parent derived from outline hierarchy (nearest ancestor with shorter
  `OutlineNumber`) → `parentExternalUid`.
- `Type` → `rawType`; canonical `type` from Milestone/Summary/OutlineLevel:
  `Milestone=1` → milestone; `Summary=1` → summary; `OutlineLevel=0` →
  project_summary; else task.
- `Critical`, `Active` → flags.
- `Start`/`Finish` → planned; `EarlyStart/Finish`, `LateStart/Finish` raw;
  `ActualStart`/`ActualFinish` → actual.
- `Duration` (`PT8H0M0S`) → parse ISO-8601 duration to minutes;
  `durationDays = durationMinutes / minutesPerDay`.
- `RemainingDuration`, `ActualDuration` → minutes.
- `PercentComplete`, `PercentWorkComplete`.
- `TotalSlack`, `FreeSlack` → MSPDI expresses these in **tenths of a minute**;
  store `*/10` as minutes (verify against a nonzero-slack task during build).
- `ConstraintType`, `ConstraintDate`, `Deadline` (when present).
- `CalendarUID` → `calendarExternalUid`.
- `ExtendedAttribute` (`FieldID` + `Value`) → `customFieldsJson` keyed by alias.
- `<Baseline><Number>0` → `baselineStart`/`baselineFinish`/
  `baselineDurationMinutes`; retain all baseline numbers in `rawBaselinesJson`.
- **Skip `TimephasedData`** (earned-value spread; ~1,600 nodes — noise).

### `<PredecessorLink>` → Relationship
- `PredecessorUID` → `predecessorExternalUid`; owning task `UID` →
  `successorExternalUid`.
- `Type` map: `0`→FF, `1`→FS, `2`→SF, `3`→SS.
- `LinkLag` (tenths of a minute) → `lagMinutes`; `LagFormat` → `rawLagFormat`;
  `CrossProject` → flag.

### Resources / Assignments / Calendars
Capture if present. (Sample files: one null resource, no real assignments —
trade partner is **not** here; see §3 normalization slice.) Calendars stored
raw as JSON.

### Date handling
MSPDI datetimes are naive local (`2025-07-07T08:00:00`). Store **as-is** — no
timezone shifting — to preserve scheduler intent. XML entities (`&amp;`) handled
by the XML parser.

### Baseline / status edge cases
- No `<Baseline>` nodes anywhere → treat this import as the baseline
  (`isBaseline = true`).
- Missing `StatusDate` → prompt the user to set it at commit.

---

## 7. Import Flow

1. Log in (shared gate).
2. Projects list → **New Project** (capture minimal profile) or select existing.
3. **Import schedule** → upload `.xml`.
4. Server parses → returns **preview before commit**:
   - detected project title; status date (or "not found — set it");
   - counts: activities / milestones / relationships / resources;
   - baseline present?;
   - **detected custom fields** (e.g. `Text1 = "Phoenix ID"`);
   - parse warnings (skipped null tasks, unsupported nodes).
5. User confirms/sets status date → **commit**.
6. Server writes the snapshot in one transaction → redirect to verification view.

The preview catches bad files early and surfaces which custom fields exist
(input the later trade-partner/scope mapping will need).

---

## 8. Verification View (only screen in Slice 1)

Per project, shows the latest import (version selector if several). Header:
project name + profile chips + import meta (status date, baseline flag, counts).

- **Phone:** activity cards — name, WBS, dates, % complete, float; tap to expand
  full detail (all fields, predecessors/successors, custom fields).
- **iPad / desktop:** denser sortable/filterable table; expandable rows.
- Controls: search (name/ID); filter (milestones / critical / in-progress /
  WBS branch); sort (start, WBS, float); group by WBS.
- Purpose: a scheduler can eyeball the import and **trust it matches the source
  file**.

---

## 9. Testing

- **Parser unit tests** against MSPDI fixtures (real exports, anonymized as
  needed): relationship-type mapping (0/1/2/3 → FF/FS/SF/SS), ISO duration →
  minutes/days, slack tenths-of-minute conversion, WBS/outline hierarchy +
  parent derivation, milestone/summary/project-summary detection, custom-field
  capture by alias, status-date extraction, missing-baseline handling, null-task
  skipping.
- **Integration test**: import a fixture → assert canonical row counts
  (activities, relationships, resources) + spot-check a known activity's fields.
- **Smoke test**: login gate → projects list → import preview → commit →
  verification view renders.

---

## 10. Open Questions / Future-Slice Notes

- **Slack units**: confirm MSPDI slack/lag tenths-of-minute assumption against a
  nonzero-slack activity during build; adjust converter if needed.
- **Multiple baselines**: only Baseline 0 promoted to columns; others retained
  raw. Revisit if teams use Baseline1–10 meaningfully.
- **Activity identity across versions** (Slice 2): `canonicalActivityKey` plus
  `externalUid` lineage — finalize matching rules when building the update loop.
- **Phoenix origin**: these MSP files were exported from Phoenix (Phoenix ID in
  Text1). The Slice 4 Phoenix importer may reuse this MSPDI path.
- **Normalization engine** (Slice 5): name normalization + bulk trade-partner
  attribution (inference-assisted, learns) + completeness checking against
  project-type templates — see §3.
