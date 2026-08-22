# Schedule Management Tool — Slice 5f Design Spec (Completeness Accept / Split)

**Date:** 2026-06-22
**Status:** Design approved; ready for implementation planning
**Owner:** Skiles Group (AJ Woodyard)
**Location:** `/home/coder/projects/Skilesconnect/schedulemanagement`
**Builds on:** Slice 5c (Completeness/split rules), Slice 5e (workflow integration), Export module.

---

## 1. Context

Slice 5c's Completeness page flags activities mapped to a canonical scope an
admin has marked "coarse," with a suggested finer-scope breakdown — but the
only action available was **Dismiss**. The 5c spec explicitly listed "actually
splitting the activity in the app" as a non-goal: "read-only flag; real
schedule edits happen upstream in MS Project, same posture as Health (5d)."

This slice adds a second action, **Accept**, that does perform the split —
but without breaking the immutable-imports rule that's held since Slice 1.
It does this by leaning on a pattern the app already has: a project's
`ScheduleImport` rows are an ordered history, and every page reads from
whichever one is newest ("latest"). Accept creates a new **synthetic**
`ScheduleImport` — not a real MS Project upload, but a snapshot cloned from
the current latest with the coarse activity replaced by its finer breakdown —
which becomes the new latest. Every existing page (project dashboard, Health,
Normalize, Trades) picks up the split automatically, with no changes to those
pages. That's the "preview, visible online, before export" the feature asks
for.

Export is then extended to actually produce a mergeable MS Project XML for
that split, since the original real file is what the user re-uploads to
Export today, and a synthetic snapshot doesn't correspond to any file they
have on hand.

**Deterministic, no AI**, per `CLAUDE.md` "Don't Build Yet" — same constraint
as all prior slices.

---

## 2. Slice Goal

Let a user **Accept** a Completeness issue: the coarse activity is replaced,
in a new schedule snapshot, by its finer breakdown — each finer activity
running in **parallel** (fan-out from the coarse activity's predecessors,
fan-in to its successors), each copying the coarse activity's full duration
and planned dates. The result is immediately visible everywhere in the app
(it's just the new "latest" import). Export can then build a real MS Project
XML containing the new task rows, ready to merge back in — with one
caveat that can't be automated away: MS Project's UID-keyed merge only
adds/updates, never deletes, so the user still manually deletes the
superseded coarse task in MS Project after merging. Export's checklist
tells them exactly which ones.

---

## 3. Product Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Where the split lives | **A new synthetic `ScheduleImport` snapshot**, cloned from the current latest, becomes the new latest. No new "working copy" concept, no new preview screen — every existing latest-import reader shows it automatically. |
| Split structure | **Parallel fan-out/fan-in.** All N finer activities start right after the coarse activity's predecessors and all feed into its successors. Each copies the coarse activity's full duration/dates (they run in parallel, so the overall schedule timeline is unaffected). Sequential chaining was considered and declined. |
| Progress continuity | **Not carried over.** Finer activities get fresh `canonicalActivityKey`s (different name) and start with no progress history. Old progress against the coarse activity stays attached to the old import as history. |
| Access | **Any logged-in user** — same level as the existing Dismiss action, not admin-gated like split-rule authoring. |
| Export scope | **Included this slice.** Export learns to insert new `<Task>`/`<PredecessorLink>` XML nodes for the split, not just patch existing ones, and to find the right original file to match against when the latest import is synthetic. |
| Manual MS Project step | **Documented, not automated.** Merge-by-UID can't delete the superseded task; Export's UI lists exactly which rows to delete by hand after merging. |

---

## 4. Data Model

One new table, two new columns on `ScheduleImport`.

```prisma
model ScheduleImport {
  // ...existing fields...
  isSynthetic         Boolean          @default(false)
  derivedFromImportId String?
  derivedFromImport    ScheduleImport?  @relation("ImportLineage", fields: [derivedFromImportId], references: [id])
  derivedImports        ScheduleImport[] @relation("ImportLineage")
  completenessSplits   CompletenessSplit[]
}

model CompletenessSplit {
  id                     String   @id @default(cuid())
  projectId              String
  project                Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sourceScheduleImportId String              // the import this was accepted from
  resultScheduleImportId String   @unique     // the synthetic import this created
  resultScheduleImport   ScheduleImport @relation(fields: [resultScheduleImportId], references: [id], onDelete: Cascade)
  coarseExternalUid      Int                 // for locating the task in the export XML
  coarseWbsCode          String?
  coarseOutlineNumber    String?
  coarseOutlineLevel     Int      @default(0)
  coarseParentExternalUid Int?
  coarseName             String
  coarseDurationMinutes  Float?
  coarseStart            DateTime?
  coarseFinish           DateTime?
  finerScopes            Json                // ordered string[]
  mintedUids             Json                // ordered number[], same order as finerScopes
  acceptedBy             String?
  createdAt              DateTime @default(now())

  @@index([projectId])
}
```

- `resultScheduleImportId` is `@unique` — exactly one `CompletenessSplit` per
  synthetic import, since each accept creates exactly one. This is how export
  finds "the operation that produced this synthetic snapshot" without diffing.
- `derivedFromImportId` lets export (and anything else that needs it) walk
  back from a synthetic latest import to the nearest **real** one, through
  however many accepts happened in between.
- `coarseWbsCode`/`coarseOutlineNumber`/`coarseOutlineLevel`/
  `coarseParentExternalUid`/`coarseDurationMinutes`/`coarseStart`/
  `coarseFinish` are captured at accept time so export can rebuild the
  original task's context without re-deriving it from a possibly-changed
  current state.
- Forward-compat: portable cuid IDs, dated rows, string `acceptedBy` —
  consistent with prior slices.

---

## 5. Accept Service — `lib/completeness/acceptSplit.ts`

```typescript
export async function acceptSplit(
  projectId: string,
  canonicalActivityKey: string,
  coarseScope: string,
  acceptedBy?: string,
): Promise<{ newImportId: string }>
```

In one transaction:

1. Load the current latest `ScheduleImport` (activities + relationships).
2. Find the coarse `Activity` by `canonicalActivityKey`. Look up its finer
   scopes via the existing `getSplitRules()` (Slice 5c), keyed on
   `coarseScope`.
3. Mint N fresh `externalUid`s: `1 + max(externalUid)` across **every**
   `Activity` ever created for this project (all imports, real or
   synthetic) — never the COALESCE of just the latest import, so repeated
   accepts can't collide with each other.
4. Create the new `ScheduleImport` (`isSynthetic: true`,
   `derivedFromImportId` = current latest's id, copying over
   `projectStart`/`projectFinish`/`minutesPerDay`/`statusDate`/`fileHash`
   from it).
5. `createMany` every other `Activity` from the latest import, unchanged,
   under the new import — **omitting** the coarse one.
6. `createMany` the N new `Activity` rows: `wbsCode` = coarse's + `.1`/`.2`/
   etc., `outlineNumber` likewise, same `outlineLevel` and
   `parentExternalUid` as the coarse activity (siblings in the same place in
   the hierarchy), `name` = the finer scope string, `externalUid` = the
   minted value, `plannedStart`/`plannedFinish`/`durationMinutes`/
   `durationDays` copied from the coarse activity, `type: "task"`,
   `isActive: true`, `canonicalActivityKey` computed via the existing
   `canonicalActivityKey(wbsCode, name)` helper (Slice 1).
7. `createMany` every `Relationship` from the latest import, unchanged,
   **except** any referencing the coarse activity's `externalUid`.
8. For every relationship where the coarse activity was the **predecessor**
   (i.e. `predecessorExternalUid === coarseUid`): add one new relationship
   per split (`predecessorExternalUid` = that split's minted uid,
   `successorExternalUid` unchanged) — fan-in.
9. For every relationship where the coarse activity was the **successor**:
   add one new relationship per split (`successorExternalUid` = that split's
   minted uid, `predecessorExternalUid` unchanged) — fan-out.
10. Create the `CompletenessSplit` row with all the captured coarse-activity
    fields, `finerScopes`, `mintedUids`, `sourceScheduleImportId`, and
    `resultScheduleImportId`.
11. Update the new import's `activityCount`/`relationshipCount`.

Returns `{ newImportId }`. Because the new import's `importedAt` is the
newest, every existing `orderBy: { importedAt: "desc" }` read (project
dashboard, Health, Normalize, Trades, Completeness itself) sees it
immediately — no changes needed in any of those services.

**`app/api/completeness/accept/route.ts`** — `POST { projectId,
canonicalActivityKey, coarseScope, acceptedBy? }` → `acceptSplit` →
`{ ok: true, newImportId }` / `{ error }` 422. No admin check (matches
Dismiss's access level).

---

## 6. UI — Completeness page

`components/CompletenessIssuesTable.tsx` gains an **Accept** button next to
Dismiss on each row. On click, a native `confirm()` summarizes the effect
(e.g. *"Replace 'Drywall' (WBS 5.2) with 3 parallel activities — Drywall
Hang, Drywall Tape, Drywall Finish — each inheriting its predecessors,
successors, and duration. Continue?"*) before firing
`POST /api/completeness/accept` and `router.refresh()` — same fire-and-refresh
pattern Dismiss already uses, no name/note capture in the UI (consistent
with Dismiss not capturing `dismissedBy` either, even though the service
supports it).

---

## 7. Export — generating real MS Project XML for the split

**`lib/msp/duration.ts`** gains the inverse of the existing parser:

```typescript
export function minutesToIsoDuration(minutes: number | null): string | null
```

**`lib/export/injectSplits.ts`** (new, alongside `injectActuals.ts`):

```typescript
export interface SplitForExport {
  coarseExternalUid: number;
  coarseWbsCode: string | null;
  coarseOutlineNumber: string | null;
  coarseOutlineLevel: number;
  coarseParentExternalUid: number | null;
  coarseDurationMinutes: number | null;
  coarseStart: Date | null;
  coarseFinish: Date | null;
  finerScopes: string[];
  mintedUids: number[];
}

export function injectSplits(doc: AnyRec, splits: SplitForExport[]): AnyRec
```

For each split, applied in chain order (oldest accept first):

1. Find the `<Task>` with `UID === coarseExternalUid` in `Tasks.Task`;
   capture its `<PredecessorLink>` children (its own predecessors); remove
   it from the array.
2. Build N new `<Task>` objects: `UID`/`ID` = the minted uid, `Name` = the
   finer scope, `WBS`/`OutlineNumber` = coarse's + `.1`/`.2`/etc.,
   `OutlineLevel` = coarse's, `Type: 1`, `Milestone: 0`, `Summary: 0`,
   `IsNull: 0`, `Start`/`Finish` from `coarseStart`/`coarseFinish` via the
   existing `toMspdiDate`, `Duration` from `coarseDurationMinutes` via the
   new `minutesToIsoDuration`. Each gets a copy of the coarse task's own
   `<PredecessorLink>` children (fan-out from predecessors).
3. Scan every other `<Task>` in the document for a `<PredecessorLink>` whose
   `PredecessorUID === coarseExternalUid`; remove that link and add one new
   `<PredecessorLink>` per split, copying the original link's `Type`/
   `LinkLag`/`LagFormat` (fan-in to successors).
4. Push the N new `<Task>` objects into `Tasks.Task`.

**`lib/export/buildExport.ts`** changes:

- When the latest import `isSynthetic`, walk `derivedFromImportId` back to
  the nearest import with `isSynthetic: false`; check the re-uploaded file's
  hash against **that** import's `fileHash`, not the latest's.
- Walk the same chain collecting each `CompletenessSplit` (oldest first) and
  call `injectSplits(doc, splits)` **before** the existing `injectActuals`/
  `injectNames` calls.
- Build a `deletedTasks: { name: string; wbsCode: string | null }[]` from the
  same `CompletenessSplit` records (the coarse activities that no longer
  exist) and return it alongside `{ fileName, xml }`.

**`app/api/export/route.ts`** keeps returning the raw XML as the response
body (unchanged — `ExportPanel` already turns the body into a downloadable
blob) and adds one response header, `X-Deleted-Tasks`, a JSON-encoded
`{ name, wbsCode }[]`, empty array when there's nothing to delete.
`ExportPanel` already reads response headers for `Content-Disposition`
(filename); it reads this one the same way.

**Export page UI** (`components/ExportPanel.tsx`) shows, after a successful
download, when the parsed `X-Deleted-Tasks` array is non-empty: *"This
export replaces N coarse activities with finer ones. After merging,
manually delete these rows from MS Project:"* followed by the name/WBS
list. The README's existing merge instructions gain the same note.

---

## 8. Testing

- **Unit** (`tests/msp/duration.test.ts`, extend): `minutesToIsoDuration`
  round-trips with `parseIsoDurationToMinutes`; `null` in, `null` out.
- **Unit** (`tests/export/injectSplits.test.ts`, new, no DB): given a doc
  with a coarse task, a predecessor link into it, and a successor link out
  of it, plus a two-finer-scope split — the coarse task is gone, two new
  tasks exist with the coarse's duration/dates, both carry the original
  predecessor link, and the successor's predecessor link now lists both new
  UIDs instead of the coarse one.
- **DB-gated** (`tests/completeness/acceptSplit.test.ts`, new,
  self-cleaning): accepting a coarse activity with a 3-way split rule
  produces a new `ScheduleImport` (`isSynthetic: true`,
  `derivedFromImportId` correct) that is now "latest"; its activities are
  the prior set minus the coarse one plus 3 new ones with minted UIDs;
  relationships are correctly fanned out/in; exactly one `CompletenessSplit`
  row exists with the right `resultScheduleImportId`.
- **DB-gated** (extend `completenessService.test.ts` or add to the above):
  after accept, a subsequent `getCompleteness` call no longer flags the
  issue (the coarse activity is gone from the new latest).
- **DB-gated** (`tests/export/buildExport.test.ts`, extend): commit a real
  import, accept a split on it, then call `buildExport` re-uploading the
  **original** real file — the ancestor-walk fileHash check passes, the
  exported XML contains the new task nodes and rewired predecessor links,
  and `deletedTasks` lists the coarse activity.
- **Build** — Completeness page's Accept button, Export page's checklist.
- **Smoke (manual):** accept a flagged activity → confirm it disappears
  from Completeness and the splits appear on the project dashboard/Health/
  Normalize immediately → export → confirm the downloaded XML has the new
  tasks and the checklist names the right row to delete.

---

## 9. Non-Goals (this slice)

- **Revert/undo an accept** — append-only history, same posture as imports
  generally. If the result is wrong, don't export it; there's no UI to
  "un-accept."
- **Editing the split activities' copied duration/dates** before export —
  they're a direct copy from the coarse activity; adjust in MS Project
  after merging if needed.
- **Sequential-chain splitting** (as opposed to parallel) — considered and
  declined for this slice.
- **Automatic deletion of the superseded task in MS Project** — not
  possible through UID-keyed merge; documented as a manual step instead.
- **Reconciling a synthetic chain against a genuinely new real upload** that
  happens before exporting the split — a fresh real upload just becomes the
  new latest as normal, same as any other re-import superseding prior
  overlays; no special handling needed.

---

## 10. Dependencies & Compatibility

- **Depends on:** Slice 1 (`Activity`/`Relationship` model,
  `canonicalActivityKey` helper), Slice 5c (`ScopeSplitRule`,
  `getSplitRules`, the Completeness page/check logic — unchanged), Export
  module (`buildExport.ts`, `injectActuals.ts`, `serializeMspdi.ts`),
  `lib/msp/duration.ts`, `lib/export/mspdiDate.ts`.
- **Reuses:** the multi-`ScheduleImport`-per-project / "latest wins"
  pattern that's been there since Slice 1 — this slice's central trick is
  using it for something other than a real upload.
- **Schema change:** one new table (`CompletenessSplit`) + two new columns
  on `ScheduleImport` (`isSynthetic`, `derivedFromImportId`) + a
  self-relation, committed with the migration per `CLAUDE.md` convention.
