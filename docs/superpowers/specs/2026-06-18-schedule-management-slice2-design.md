# Schedule Management Tool — Slice 2 Design Spec

**Date:** 2026-06-18
**Status:** Design approved; ready for implementation planning
**Owner:** Skiles Group (AJ Woodyard)
**Location:** `/home/coder/projects/Skilesconnect/schedulemanagement`
**Builds on:** Slice 1 (`2026-06-17-schedule-management-slice1-design.md`)

---

## 1. Slice Goal

Deliver the **lookahead + weekly update loop** — the historical-data engine
behind Goal #1 of the product vision: *make maintaining the schedule easy enough
that it actually happens every week.*

A field user opens a project's 3- or 6-week lookahead, records progress on the
near-term activities (status, actual dates, % complete, optional note), and
finalizes it as an immutable, versioned weekly snapshot. The accumulating
snapshots are the consistent history later slices turn into scheduling
intelligence.

This slice is **record-only**: it captures what happened, it does not recompute
the schedule.

---

## 2. Scope

### In scope

- Per-project **weekly update loop**: start an update, record per-activity
  progress, save as a resumable draft, finalize into an immutable snapshot.
- **Lookahead computation** (3 / 6 week) anchored on an update's as-of date, with
  a past-due catch-all so nothing slips off the radar.
- **Current-progress overlay**: the verification view and lookahead reflect the
  latest finalized progress per activity.
- **Update history** per project; finalized updates open read-only.
- Two new tables (`ProgressUpdate`, `ProgressEntry`); no changes to Slice 1
  tables (imports stay immutable).

### Out of scope (non-goals)

- **No CPM recompute** — no forward/backward pass, no projected/forecast dates,
  no critical-path recalculation. Recalculation stays in the scheduling software
  and round-trips via Slice 3. *(A future "schedule building tool" that consumes
  this history is a later-slice concern, not designed here.)*
- **No editing of schedule structure** — no adding/removing/reordering
  activities, no name edits.
- **No export-back** to the scheduling software (Slice 3).
- **No fuzzy activity matching** across re-imports — exact `canonicalActivityKey`
  only.
- **No per-field autosave**, no real-time/multi-user concurrency handling.
- **No per-user auth** — the shared login from Slice 1 stays.
- **No trade-partner / scope normalization** (Slice 5).

---

## 3. Product Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Core weekly action | **In-app progress capture** against the latest import; re-import still happens occasionally; export-back is Slice 3. |
| Captured per activity | **Status** (not-started / in-progress / complete), **actual start**, **actual finish**, **% complete**, optional **note**. |
| Lookahead anchor & inclusion | **As-of date** (defaults today, user-settable) + **catch-all** (in-progress, starts-in-window, finishes-in-window, spans-window, or past-due-incomplete). |
| Recalculation | **Record only.** No CPM engine. |
| Storage model | **Delta snapshots** — `ProgressUpdate` + `ProgressEntry`, overlaid on the latest import; touched activities only; lineage via `canonicalActivityKey`. |

---

## 4. Data Model (Prisma)

Two new tables. Existing Slice 1 tables are unchanged; imports remain immutable
snapshots. Conventions match Slice 1 (cuid IDs, cascade relations, indexes).

```prisma
model ProgressUpdate {            // one per weekly cycle
  id               String   @id @default(cuid())
  projectId        String
  project          Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  scheduleImportId String                       // the import this update is measured against
  scheduleImport   ScheduleImport @relation(fields: [scheduleImportId], references: [id], onDelete: Cascade)
  asOfDate         DateTime                      // anchors the lookahead (defaults today, user-settable)
  lookaheadWeeks   Int      @default(3)          // 3 or 6
  state            String   @default("draft")    // draft | finalized
  submittedBy      String?                       // string for now, matches ScheduleImport.importedBy
  note             String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  finalizedAt      DateTime?
  entries          ProgressEntry[]

  @@index([projectId])
  @@index([scheduleImportId])
}

model ProgressEntry {             // one per touched activity (delta only)
  id                   String   @id @default(cuid())
  progressUpdateId     String
  progressUpdate       ProgressUpdate @relation(fields: [progressUpdateId], references: [id], onDelete: Cascade)
  activityExternalUid  Int                        // identifies the activity within the update's import
  canonicalActivityKey String                     // lineage across re-imports
  status               String                     // not_started | in_progress | complete
  actualStart          DateTime?
  actualFinish         DateTime?
  percentComplete      Int?
  note                 String?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([progressUpdateId])
  @@index([canonicalActivityKey])
}
```

Back-relations added: `Project.progressUpdates ProgressUpdate[]` and
`ScheduleImport.progressUpdates ProgressUpdate[]`.

### Notes

- **Forward-compat (spec §2 conventions):** portable cuid IDs, dated rows,
  raw-capture-friendly. `submittedBy` stays a string, deferring real actor
  identity exactly like Slice 1's `importedBy`. Each finalized `ProgressEntry` is
  already activity-event-shaped, so the weekly events are reconstructable for
  later Connect / analytics use with no re-capture.
- **Date handling:** `asOfDate`, `actualStart`, `actualFinish` stored without
  timezone shifting, consistent with Slice 1's naive-local MSPDI handling, so a
  "complete on 6/12" does not drift across a day boundary.
- **Touched activities only:** an activity with no `ProgressEntry` in any
  finalized update means "no progress reported yet" — keeps weekly updates light.
- **SQLite/Postgres:** Postgres on Railway is the target; no SQLite-specific
  choices here.

---

## 5. Lookahead Computation & Current Progress

All read-time logic; no recompute. Implemented as a pure, unit-testable module
`lib/lookahead/computeLookahead.ts`, decoupled from React.

### 5.1 Current-progress overlay

For any activity, effective progress = the **most recent *finalized*
`ProgressEntry` matching its `canonicalActivityKey`**. Drafts count only inside
the draft currently being edited. The lookahead and the Slice 1 verification view
both render as *latest import's activity rows + this overlay*. An untouched
activity reads as "no progress reported."

### 5.2 Lookahead inclusion (the catch-all)

Window = `asOfDate → asOfDate + N weeks` (N ∈ {3, 6}). A **leaf** activity
(tasks + milestones; `summary` and `project_summary` rows excluded as structural
roll-ups; inactive activities excluded) appears if **any** of:

1. **in progress** — effective status `in_progress`, or has an actual start with
   no actual finish; or
2. planned to **start** within the window (`plannedStart ∈ [asOfDate, asOfDate+N]`); or
3. planned to **finish** within the window (`plannedFinish ∈ [asOfDate, asOfDate+N]`); or
4. **spans** the window (`plannedStart ≤ asOfDate ≤ plannedFinish`); or
5. **past-due & incomplete** (`plannedFinish < asOfDate` and effective status ≠
   `complete`) — the catch-all.

### 5.3 Slippage flags (derived, display-only)

Computed from planned dates + effective progress, **not** a CPM pass:

- `overdue` — `plannedFinish < asOfDate` and not complete
- `should-have-started` — `plannedStart < asOfDate` and status still not-started
- `on-track` — otherwise

### 5.4 Re-import lineage

A `ProgressUpdate` is bound (via `scheduleImportId`) to the import it was measured
against. When the scheduler re-imports a newer schedule:

- New updates are created against the **new latest** import.
- Each activity's editor row **pre-fills last-known progress** from the latest
  finalized `ProgressEntry` matching its `canonicalActivityKey`, regardless of
  which import produced it — progress carries forward automatically.
- Matching is **exact `canonicalActivityKey`** only. An activity renamed or
  re-coded between imports will not auto-match; its prior progress remains in
  history but does not pre-fill. Genuinely new activities start fresh. Fuzzy /
  lineage matching is a **future refinement** (see Slice 1 spec §10), not built
  here.

---

## 6. User Flow, Routes & Components

Mobile-first. Follows Slice 1 patterns: server components read Prisma directly;
form POST handlers return a 303 redirect built from `lib/http.ts`
`requestBaseUrl` (the proxy-safe helper).

### 6.1 The weekly loop

1. From a project's verification view, a **"Weekly Update"** action plus a link to
   update history. This is the only navigation addition and is owned by this
   feature.
2. **Start update:** set `asOfDate` (defaults today) and window (3 or 6 weeks) →
   creates a `draft` `ProgressUpdate`, redirects into the editor.
3. **Editor** lists the computed lookahead activities as mobile cards / desktop
   rows. Each row: status toggle (not-started / in-progress / complete), actual
   start, actual finish, % complete, note — pre-filled with last-known progress
   and tagged with any slippage flag.
4. **Save draft** persists all entries in one POST (resumable later).
   **Finalize** persists + locks the update (`state = finalized`, `finalizedAt`
   set) — immutable thereafter, mirroring the import preview→commit pattern.
5. **History:** per-project list of updates; finalized ones open read-only.

### 6.2 Routes (App Router)

- `app/projects/[id]/updates/page.tsx` — update history + "New update"
- `app/projects/[id]/updates/[updateId]/page.tsx` — editor (draft) or read-only
  view (finalized)
- `app/api/updates/route.ts` — `POST` create draft
- `app/api/updates/[updateId]/entries/route.ts` — `POST` save entries (upsert)
- `app/api/updates/[updateId]/finalize/route.ts` — `POST` finalize

### 6.3 Components

- `components/LookaheadUpdateForm.tsx` — per-activity progress UI (cards on phone,
  table on desktop), styled consistently with `ActivityTable`.
- `components/UpdateHistory.tsx` — the per-project update list.

### 6.4 Update lifecycle & immutability rules

- **At most one `draft` update per project.** Clicking "New update" when a draft
  already exists **resumes** that draft rather than creating a second one; the
  create handler enforces this. A new draft can only start once the prior update
  is finalized.
- A `finalized` update rejects further entry saves and a second finalize
  (enforced server-side in the route handlers).
- Editing after finalize means starting a **new** update — there is no un-finalize.

### 6.5 Deliberate simplicity

One save-all-entries POST per draft (no per-field autosave — a future
refinement), no client-heavy state, consistent with the project's "don't build
complex yet" boundary.

---

## 7. Telemetry Profile

**Explicit opt-out** (per the project's manifest-telemetry rule).

- **Reason:** the standalone app has no manifest / telemetry infrastructure (no
  zone/node system present — confirmed in code). Slice 1 shipped without one.
- **Revisit trigger:** when Connect integration lands (the `externalProjectKey`
  linkage) or a manifest/telemetry system is introduced to the app — whichever
  comes first. The weekly-update events (already activity-event-shaped via
  `ProgressEntry`) are the natural first thing to emit at that point.

---

## 8. Testing

- **Unit (pure, no DB)** — `computeLookahead`: as-of anchoring; each inclusion
  branch (in-progress, starts-in-window, finishes-in-window, spans-window,
  past-due catch-all); summary-row and inactive exclusion; slippage flags
  (overdue / should-have-started / on-track); window 3 vs 6.
- **Unit** — current-progress overlay resolver: latest **finalized** entry by
  `canonicalActivityKey` wins; drafts ignored for "current"; carry-forward
  pre-fill across a re-import.
- **Integration (DB-gated, like Slice 1's `commitImport` tests, run only when
  `DATABASE_URL` is set)** — create draft → save entries → finalize → assert
  immutability (a second finalize/save is rejected) and that the overlay reflects
  finalized values.
- **Smoke** — project → start update → editor renders lookahead → save →
  finalize → history shows it read-only.

---

## 9. Dependencies & Compatibility

- **Depends on:** Slice 1 (canonical model, `canonicalActivityKey`, verification
  view, shared login, `lib/http.ts`).
- **Schema change:** new tables only; ships with a Prisma migration committed
  alongside the schema (per repo Git convention). Applied on Railway via
  `prisma migrate deploy` on release.
- **Reuses:** `lib/http.ts` `requestBaseUrl`, `ActivityTable` styling, the
  preview→commit / draft→finalize pattern, the DB-gated test convention.

---

## 10. Open Questions / Future-Slice Notes

- **Fuzzy lineage:** exact-key matching will miss renamed/re-coded activities.
  Revisit when a normalization dictionary exists (Slice 5) — it can power lineage
  matching too.
- **Forecasting:** projected dates / critical-path recompute deferred; a future
  "schedule building tool" may consume this history (relates to Slice 5
  cross-project aggregation).
- **Autosave:** single save-all POST now; per-field autosave is a UX refinement
  if weekly lists get long.
- **Actor identity:** `submittedBy` is a string until per-user auth lands.
```
