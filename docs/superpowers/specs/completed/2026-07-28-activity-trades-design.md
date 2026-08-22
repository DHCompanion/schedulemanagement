# Activity trades, round-trip drift, and batch splits

Date: 2026-07-28
Status: approved, not yet implemented

Three changes, related by the schedule view finally showing who is doing the
work and by that answer surviving a trip through MS Project.

1. An activity's discipline and trade partner appear when you open it in the
   schedule view, and are searchable and filterable.
2. The export writes both into the MS Project file. A later import reads them
   back and flags anything the file disagrees with.
3. Accepting a coarse-activity split applies to every identical coarse activity
   in the schedule, not just the one clicked.

## 1. Trade on the activity row

### Derivation, not storage

An activity's trade is already fully derivable, and every link exists:

```
activity.name
  -> normalizeName          -> ScopeDictionaryEntry.canonicalScope
  -> TradeDictionaryEntry   -> osDisciplineId + disciplineName
  -> ProjectTradeAssignment -> partnerName        (keyed projectId + osDisciplineId)
```

Nothing new is stored. This mirrors how the project page already resolves
`canonicalScope` at read time, and it means a trade reassignment is reflected
everywhere at once instead of leaving stale copies on activity rows.

### Components

**New** — `lib/trades/activityTrades.ts`:

```ts
resolveActivityTrades(
  projectId: string,
  activities: { id: string; name: string }[],
): Promise<Map<string, { disciplineName: string; partnerName: string | null }>>
```

It composes three existing loaders — `getDictionary`, `getTradeDictionary`,
`getProjectAssignments` — into one pass. Three queries total regardless of
activity count; no per-activity query.

An activity resolves to nothing when its name is unmapped, when its scope has
no discipline, or when the discipline has no assigned partner. Each is a normal
state, not an error.

**Changed** — `app/projects/[id]/page.tsx` calls it once and puts
`disciplineName` / `partnerName` on `ActivityRow`, exactly as it already does
for `canonicalScope`.

**Changed** — `components/ActivityTable.tsx`:

- Both values render in the expanded `<dl>`, alongside ID / % complete /
  duration / float.
- Both join the search haystack in `leafMatches`, so the existing box finds
  "Amber" or "ELECTRICAL".
- One new `<select>` filters by discipline, listing only disciplines present in
  the schedule.

A single select is deliberate. One partner per discipline per project is the
confirmed model, so a discipline filter is already a partner filter; a second
control would be two inputs for one fact.

Unresolved activities render nothing rather than "Unassigned". The Trades page
is where that gap gets worked; repeating it on every row is noise.

## 2. Round-trip and drift

### Out: injectTrades

A new `lib/export/injectTrades.ts`, mirroring the existing `injectNames`, does
two things to the parsed document:

1. Registers two task extended-attribute definitions under
   `Project/ExtendedAttributes`, with aliases **"Discipline"** and
   **"Trade Partner"**.
2. Writes a matching `ExtendedAttribute` (FieldID + Value) onto each `Task`
   whose UID resolves to a trade.

They appear as ordinary columns in MS Project.

Slots are chosen as the first Text fields not already defined in the uploaded
file — the importer reports every existing definition, so a collision with a
customer's own custom field is avoidable rather than hoped against. In the
current BSW schedules only `Text1` is taken (alias "Phoenix ID"), so `Text2`
and `Text3` are free.

The MSPDI FieldID constants (`Text2` = 188743734, `Text3` = 188743737) must be
verified by a real MS Project round-trip, not trusted from a table. A wrong
FieldID makes the columns silently fail to appear — the exact class of silent
failure this codebase has been removing.

Called from `buildExport` alongside `injectActuals` / `injectNames` / 
`injectSplits`.

### Back: drift detection

The importer already parses task `ExtendedAttribute` values into
`Activity.customFields`, keyed by **alias**. So a re-imported file carries
`customFields["Discipline"]` and `customFields["Trade Partner"]` with no
importer change at all. The alias is the contract; keep the two strings stable.

Drift is computed at read time: for each activity in the latest import that
carries a "Trade Partner" value, compare it against the freshly derived partner
for that activity's discipline.

Disagreements roll up to one row per **(discipline, distinct file value)**, not
per discipline alone. If a file names two different partners on two electrical
tasks, that is two rows — collapsing them would force one answer onto two
different edits and hide the second.

**Only "Trade Partner" is diffed.** "Discipline" is written out for visibility in
MS Project but not compared on the way back. A changed discipline column would
mean re-pointing a scope at a different trade, which is the scope-to-discipline
dictionary's job and is edited on the Unmapped Activities tab with the roster in
front of you. Diffing it would need a second dismissal key and a second
resolution path to serve an edit nobody has asked to make in MS Project.

**Compare against the derived value, not a stored export snapshot.** A snapshot
table would separate "someone edited MS Project" from "we changed the assignment
in the tool since exporting", but costs a table, a migration, and a write on
every export to distinguish two cases that both deserve review. Derived
comparison stores nothing and catches both.

### Review UI

A fourth tab on the Trades page — **Changed in MS Project** — beside Unmapped
Activities, Trade Assignment, and Dismissed. Each row shows the discipline, the
file's value, and the tool's, with two actions:

- **Accept file** — updates `ProjectTradeAssignment` to the partner named in the
  file, when that partner is on the project roster. A name that matches no
  roster partner is shown and reported, never guessed at; Connect owns the
  roster and inventing an id here would misroute a trade.
- **Keep tool's** — records a dismissal so the row stops re-appearing.

### Schema

One new table:

```prisma
model TradeDriftDismissal {
  id             String   @id @default(cuid())
  projectId      String
  project        Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  osDisciplineId Int
  fileValue      String   // the partner name in the file when dismissed
  dismissedBy    String?
  personId       Int?
  createdAt      DateTime @default(now())

  @@unique([projectId, osDisciplineId, fileValue])
  @@index([projectId])
}
```

Keyed on `fileValue` so a *different* later edit re-flags rather than inheriting
an old dismissal. Portable ids, generic actor shape, no local number minting,
per `docs/architecture/FORWARD_COMPATIBILITY.md`. Schema and migration commit
together.

## 3. Batch splits

`acceptSplit(projectId, canonicalActivityKey, coarseScope, ...)` currently
splits exactly one activity and creates one synthetic import for it. Accepting
eight instances of "MEP OH Rough-In" therefore stacks eight synthetic imports.

It becomes: resolve every currently-flagged activity sharing that coarse rule,
minus per-instance dismissals, and split all of them inside the existing
transaction — one synthetic import.

Dismissed instances are skipped. Dismissing was a deliberate "not this one" and
a batch accept must not silently undo it.

### The blocking constraint

`CompletenessSplit.resultScheduleImportId` is `@unique`. That hard-codes one
split per synthetic import, so N splits sharing one result import violate it.

Required changes:

- Drop `@unique` on `resultScheduleImportId` to a plain `@@index`.
- `resolveExportBase` moves from `findUnique` to `findMany` on that column,
  collecting every split recorded against a synthetic import.
- `injectSplits` already accepts an array and needs no change.

UID minting already allocates from `max(externalUid) + 1`; it extends to
allocate across all coarse activities in the batch. Relationship fan-out runs
per coarse activity as it does today.

### UI

The accept button states the blast radius before it runs — "splits 7 activities
into 28 tasks" — because it is no longer one row.

## Error handling

- **Unresolvable trade** (unmapped name, no discipline, no partner) — renders
  nothing. Normal state.
- **Drift naming an off-roster partner** — surfaced with the name, not applied.
  Connect owns the roster.
- **Existing custom field collision** — slots picked from the file's own
  declared definitions, so an occupied Text1 is skipped rather than overwritten.
- **Export with no trades resolved** — writes no attributes and no definitions,
  rather than an empty column.
- **Batch split where every instance is dismissed** — nothing to do; the accept
  action is not offered.

## Testing

Unit, no database:

- `resolveActivityTrades` — full chain, and each broken link (unmapped name,
  scope with no discipline, discipline with no partner).
- `injectTrades` — definitions registered once; values on the right tasks;
  occupied slots skipped; no-trades case writes nothing.
- Drift comparison — agreement, disagreement, missing field, dismissed.

Database-gated, following the existing `describe.runIf(hasDb)` pattern:

- Batch split — N flagged instances produce one synthetic import with N splits
  recorded, dismissed instances untouched, relationships fanned per instance.
- `resolveExportBase` — walks back through a synthetic import carrying several
  splits.

Round-trip, using the real BSW fixture: export, re-parse the output, and assert
the two aliases survive with the right values.

The MS Project verification (that MS Project itself renders the columns) is
manual and must be done before this ships.

## Implementation order

Three pieces, two of which are coupled:

1. **Batch splits** first. Independent of the other two, blocked by nothing, and
   it carries the schema change to `CompletenessSplit` — worth landing and
   verifying on its own rather than alongside a new table.
2. **Trade on the activity row** next. `resolveActivityTrades` is the unit the
   export then reuses.
3. **Round-trip and drift** last, since `injectTrades` depends on step 2 and the
   drift tab depends on `injectTrades` having produced a file to re-import.

Each step builds, tests, and is reviewable on its own.

## Out of scope

- Per-activity partner overrides. Two partners on one discipline in the current
  data is a test artifact from another app, not a real requirement.
- Task renames in MS Project. That is the naming dictionary's problem.
- Diffing the "Discipline" column on re-import. Written out, not compared; see
  the drift section for why.
- Writing trade data back to Connect. The OS owns the roster; this feature
  reads it.
