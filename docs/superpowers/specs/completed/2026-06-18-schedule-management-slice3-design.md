# Schedule Management Tool — Slice 3 Design Spec

**Date:** 2026-06-18
**Status:** Design approved; ready for implementation planning
**Owner:** Skiles Group (AJ Woodyard)
**Location:** `/home/coder/projects/Skilesconnect/schedulemanagement`
**Builds on:** Slice 1 (import + canonical model) and Slice 2 (weekly update loop)

---

## 1. Slice Goal

Round-trip the field progress captured in Slice 2 **back into the scheduling
software**. The scheduler re-uploads the MS Project XML they originally imported;
the app injects the cumulative current actuals/% complete into the matching tasks
and hands back an updated MS Project XML file they re-import to bring the master
schedule current.

This slice is **record-only carried to its conclusion**: it writes the actuals
the field reported, it does not recompute the schedule (the scheduling software
does that on re-import).

---

## 2. Scope

### In scope

- **Export to MS Project XML (MSPDI):** re-upload the original file → inject
  cumulative current progress → download an updated file.
- **Cumulative current state:** applies the latest finalized progress per activity
  across all weekly updates (the Slice 2 current-progress overlay).
- **Fields written:** `ActualStart`, `ActualFinish`, `PercentComplete` (status
  driven, with fallbacks), plus the project `StatusDate`.
- **Safety:** the uploaded file must hash-match the project's latest import.
- Export page + client upload/download panel.

### Out of scope (non-goals)

- **No re-upload-free export.** Storing raw XML at import to skip the re-upload is
  a future enhancement ("Approach B"), not built here.
- **No CPM recompute**, remaining-duration, or forecast writing.
- **No notes** written into the file (they stay in-app).
- **No reconciling structural drift** between the uploaded file and the stored
  import — the hash-match forbids a mismatched file.
- **No persisted export history / audit log.**
- **MSPDI only** — no P6/Phoenix-native export formats.
- **Working-time precision:** actual times land at `T00:00:00` (date-only capture).

---

## 3. Product Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Export target | **MS Project XML (MSPDI) round-trip.** |
| Mechanism | **Approach A — re-upload the original file + inject.** We never stored the raw XML, so the scheduler supplies it; we verify by `fileHash`. |
| Export contents | **Cumulative current state** — latest finalized progress per activity across all updates. |
| Fields written | `ActualStart`, `ActualFinish`, `PercentComplete` (status-driven); notes excluded. |
| Recalculation | **None.** The scheduling software recalculates on re-import. |

---

## 4. Data Model

**No schema change.** Approach A is computed on the fly: the export reads existing
data, takes an uploaded file, emits a file, and persists nothing. (An export
history/audit record is a future enhancement, not built here.)

---

## 5. Identity & Matching

**Match the uploaded file to an import.** On upload, hash the file (SHA-256, the
same `fileHash` Slice 1 stores) and require it to match the project's **latest**
`ScheduleImport`. If it does not match, reject with: *"This file doesn't match the
current imported schedule — export the file you most recently imported."* The
hash-match guarantees `Task UID` ↔ `Activity.externalUid` line up exactly, so no
fuzzy matching is needed.

**Map progress onto the file's tasks** (three hops, all from existing data):

1. Compute the cumulative overlay —
   `resolveCurrentProgress(getFinalizedEntries(projectId))` →
   `Map<canonicalActivityKey, ActivityProgress>` (the exact Slice 2 functions).
2. From the matched import's stored activities, build
   `Map<externalUid, canonicalActivityKey>`.
3. For each `<Task UID=…>` in the uploaded file, resolve
   `uid → canonicalActivityKey → progress` and inject. Tasks with no reported
   progress are left untouched.

---

## 6. Injection Pipeline & Field/Date Mapping

Two pure, unit-testable modules plus a serialization step.

### 6.1 `lib/export/injectActuals.ts` (pure)

Takes the parsed XML document object + `Map<uid, ProgressForExport>` (where
`ProgressForExport` carries the activity's status, actual start/finish, and
percent complete) and mutates matching `<Task>` nodes. Fallbacks read the task's
**own existing `Start`/`Finish`** from the uploaded file (the file is the source of
truth for planned dates), so no planned dates are threaded through the map:

| Status | Writes |
|--------|--------|
| `complete` | `PercentComplete=100`; `ActualFinish` = actual finish, else the task's `Finish`; `ActualStart` = actual start, else the task's `Start` |
| `in_progress` | `ActualStart` = actual start, else the task's `Start`; `PercentComplete` = entry's % when set |
| `not_started` | nothing — task left exactly as-is |

Only `ActualStart`, `ActualFinish`, `PercentComplete` elements are added or
overwritten; all other task data is preserved. Tasks absent from the map are
untouched.

### 6.2 `lib/export/mspdiDate.ts` (pure)

MSPDI datetimes are naive-local (`2026-06-15T08:00:00`). Slice 1's `toDbDate`
stored dates as UTC wall-clock (appended `Z`), so this is the inverse: format the
Date's UTC components to `YYYY-MM-DDTHH:MM:SS` with no zone suffix. The Slice 2
form captures date-only actuals, so the time emits as `T00:00:00` (known
simplification — could later default to the calendar's working-day start).

### 6.3 Serialization

Parse the uploaded file with `fast-xml-parser` configured to preserve attributes
and structure, inject, then rebuild with its `XMLBuilder` using matching options.
**Round-trip fidelity is the primary risk** (attribute/element ordering). Exactly
as Slice 1 validated the parser, a test round-trips a real fixture (parse → inject
→ build → re-parse) and asserts structure/counts are preserved and only the
targeted fields changed. If fidelity proves insufficient, the fallback is targeted
node editing; the plan starts with the parser round-trip.

### 6.4 Status date

The export sets the project's `StatusDate` to the **most recent finalized
update's `asOfDate`** (the max `asOfDate` among the project's finalized updates),
so the re-imported schedule reflects the correct data date.

---

## 7. Flow, Routes & Components

Mirrors the Slice 1 import-wizard pattern (client component + `fetch`, inline
errors) so file-operation errors are handled cleanly.

### 7.1 Flow

1. From the project page, an **"Export to MS Project"** action (third button
   alongside Weekly updates / Import schedule).
2. **Export page** (server component) shows context computed server-side: the
   latest import's file name + a progress summary (e.g. "23 activities have
   reported progress — 8 complete, 15 in progress"). If there are no finalized
   updates, it says so and offers nothing to upload.
3. **`ExportPanel`** (client) has a file input — *"Re-upload the original `.xml`
   you imported"* — and POSTs the file via `fetch`.
4. The route returns **either** the updated `.xml` as a download (success) **or** a
   JSON error (mismatch / no progress). The client triggers a blob download on
   success or shows the message inline.

### 7.2 Routes

- `app/projects/[id]/export/page.tsx` — context + panel.
- `app/api/export/route.ts` — `POST`: hash-match the file → build the
  UID→progress map → parse → inject → set `StatusDate` → serialize → respond with
  `Content-Type: application/xml` and
  `Content-Disposition: attachment; filename="<original>-updated-<asOfDate>.xml"`.
  On any guard failure, JSON `{ error: { message } }` with status 422.

### 7.3 Components & orchestration

- `components/ExportPanel.tsx` — upload + blob download + inline errors (client).
- Server export page — loads project, latest import, computes the progress summary.
- `lib/export/buildExport.ts` — thin server orchestrator:
  `(projectId, uploadedXml, uploadedHash) → { fileName, xml }`, composing the
  matching rules (§5), `injectActuals`, and `mspdiDate`. Keeps the route handler
  thin and the logic testable.

---

## 8. Telemetry Profile

**Explicit opt-out**, consistent with Slices 1–2.

- **Reason:** the standalone app has no manifest/telemetry infrastructure.
- **Revisit trigger:** Connect integration (the `externalProjectKey` linkage) or a
  telemetry system landing — at which point an export event is a natural emission.

---

## 9. Testing

- **Unit (pure)** — `injectActuals`: each status mapping + fallbacks (complete with
  missing actual-finish → planned finish; in-progress with missing actual-start →
  planned start); not-started leaves the task untouched; only matching UIDs change;
  non-progress tasks preserved.
- **Unit (pure)** — `mspdiDate`: UTC-stored Date → naive `YYYY-MM-DDTHH:MM:SS`
  (strips `Z`); date-only → `T00:00:00`.
- **Round-trip fidelity (fixture)** — parse `tests/fixtures/minimal.xml` → inject a
  known activity → serialize → re-parse → assert activity count unchanged, an
  untouched task identical, and the injected task carries the new
  `ActualFinish`/`PercentComplete`.
- **DB-gated** — `buildExport`: hash mismatch throws; no finalized progress throws;
  correct UID→canonicalKey→progress mapping produces the expected injections.
- **DB-gated (route)** — matching file → 200 `application/xml` with updated fields;
  mismatched file → 422.
- **Smoke (manual)** — project with a finalized update → Export page → re-upload
  original → download → re-parse/open in MS Project and confirm actuals applied.

---

## 10. Dependencies & Compatibility

- **Depends on:** Slice 1 (`fileHash`, canonical activities, `parseMspXml`,
  `tests/fixtures/minimal.xml`) and Slice 2 (`resolveCurrentProgress`,
  `getFinalizedEntries`, `ProgressEntry`).
- **Reuses:** `fast-xml-parser` (already a dependency, used by the importer), the
  import-wizard client/fetch pattern, the DB-gated test convention, `toDbDate`
  semantics (inverted by `mspdiDate`).
- **No schema change**, so no migration.

---

## 11. Open Questions / Future-Slice Notes

- **Re-upload-free export (Approach B):** start storing raw XML at import to enable
  one-click export; needs a re-import/backfill for pre-existing imports.
- **Serializer fidelity:** if `fast-xml-parser` round-trip loses MSPDI structure MS
  Project rejects, switch to targeted node editing — decide during the fidelity
  test against a real Skiles file.
- **Working-time precision:** date-only actuals emit `T00:00:00`; revisit if MS
  Project re-import wants working-day start times.
- **Export history:** persisting an audit record of each export is deferred.
