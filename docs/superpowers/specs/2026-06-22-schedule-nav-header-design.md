# Schedule Management Tool — Project Dashboard Nav Header Redesign

**Date:** 2026-06-22
**Status:** Design approved; ready for implementation planning
**Owner:** Skiles Group (AJ Woodyard)
**Location:** `/home/coder/projects/Skilesconnect/schedulemanagement`
**Touches:** `app/projects/[id]/page.tsx`, `app/projects/[id]/{normalize,completeness,updates,import,health}/page.tsx`, `components/WizardBanner.tsx`

---

## 1. Context

The project dashboard header (`app/projects/[id]/page.tsx:46-71`) renders 7
links in one row: Schedule health, Normalize activity names, Completeness,
Trades, Weekly updates, Export to MS Project, Import schedule. All 7 share one
flat button style (outlined, except a solid dark "Import schedule"). This
reads as crowded and inconsistently capitalized ("Export to MS Project" vs.
"Trades" vs. "Weekly updates"), and two labels ("Normalize activity names",
"Completeness") don't clearly describe what the destination does.

Explored via the visual companion: three theming directions (pill cluster
with a grouped "Setup/Refinement" box, icon cards, underlined toolbar) — the
muted-pill direction (A) was preferred, but the grouping box itself was
rejected in favor of a single flat row using that same pill styling.

---

## 2. Goal

1. Replace all 7 button labels with a consistent Title Case naming scheme,
   and rename the two unclear ones.
2. Restyle the row from flat slate-bordered/black-primary buttons to muted
   ghost-pills with one teal primary action, no visual sub-grouping.
3. Remove "Schedule health" from the header entirely — fold its 4 progress
   metrics into the existing import-metadata box below the header, as a
   clickable second row linking through to the full health page.

---

## 3. Product Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Visual theme | Muted ghost-pill buttons (`border-slate-300`, white background, `slate-700` text) for all secondary actions; one solid `cyan-700` primary button for the single most-committal action (Import Schedule). No card/box/divider grouping — one flat flex row, same as today's wrapper, just restyled. |
| Label renames | "Normalize activity names" → **Task Naming**. "Completeness" → **Task Granularity** (it splits coarse/summary activities into finer detail — "Completeness" didn't describe that). "Weekly updates" → **Progress Update**. "Import schedule" → **Import Schedule**. "Export to MS Project" unchanged (already correctly cased). "Trades" unchanged. |
| Capitalization rule | Title Case across every nav label and every destination page's `<h1>`: capitalize all words except short function words ("to", "a", "of"); acronyms (MS) stay fully capped. |
| Grouping | Considered clustering Task Naming / Task Granularity / Trades under a labeled "Setup/Refinement" box — **rejected**. Final order is a flat row, sequenced setup-ish-first → Progress Update → Export to MS Project → Import Schedule (primary, rightmost), but with no visual box or divider marking the boundary. |
| Schedule health | **Removed from the nav row.** Its 4 progress metrics (Total/Completed/Remaining/% Complete) move into the existing import-metadata box (file/imported/status date) as a second row, fed by the same `getScheduleHealth().progress` the health page already computes. The whole metrics row is a `<Link>` to `/projects/[id]/health` (no separate "view details" text — the row itself is the click target, with a hover background to signal it). The full health page (and its 4 issue-check sections — out-of-envelope dates, future actuals, missing dates, percent contradictions) is unchanged and still reachable this way; only its `<h1>` is recapitalized to "Schedule Health". |

---

## 4. Implementation

### 4.1 `app/projects/[id]/page.tsx`

**Header row (replaces lines 46-71):** same outer wrapper
(`flex flex-wrap items-center justify-between gap-2`) and project-title `<h1>`,
but the button row becomes one flat list of 6 links (health link deleted),
restyled and relabeled:

```tsx
<div className="flex flex-wrap items-center gap-2">
  <Link href={`/projects/${project.id}/normalize`} className={ghostPill}>Task Naming</Link>
  <Link href={`/projects/${project.id}/completeness`} className={ghostPill}>Task Granularity</Link>
  <Link href={`/projects/${project.id}/trades`} className={ghostPill}>Trades</Link>
  <Link href={`/projects/${project.id}/updates`} className={ghostPill}>Progress Update</Link>
  <Link href={`/projects/${project.id}/export`} className={ghostPill}>Export to MS Project</Link>
  <Link href={`/projects/${project.id}/import`} className={primaryPill}>Import Schedule</Link>
</div>
```

where (inlined or as local `const` strings in the file, matching this
codebase's existing inline-className convention):

- `ghostPill` = `"rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"`
- `primaryPill` = `"rounded-lg bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-800"`

Routes (`/normalize`, `/completeness`, `/updates`, `/export`, `/import`) are
unchanged — only the visible label and class change.

**Data fetch:** add `const health = await getScheduleHealth(project.id);`
alongside the existing `prisma.scheduleImport.findFirst` / `getFinalizedEntries`
calls (import from `@/lib/health/healthService`).

**Metadata box (lines 82-87):** keep the existing file/imported/status-date/
counts `<div>` exactly as-is, then add a second block directly below it,
inside the same `!latest` conditional, only when `health.hasImport`:

```tsx
<Link
  href={`/projects/${project.id}/health`}
  className="mb-4 -mt-4 flex flex-wrap gap-4 rounded border border-t-0 border-slate-200 bg-white p-3 text-sm text-slate-600 hover:bg-slate-50"
>
  <div><span className="font-medium">{health.progress.total}</span> total</div>
  <div><span className="font-medium">{health.progress.completed}</span> completed</div>
  <div><span className="font-medium">{health.progress.remaining}</span> remaining</div>
  <div><span className="font-medium">{health.progress.percentComplete}%</span> complete</div>
</Link>
```

(`border-t-0` + negative top margin visually fuses it to the existing box
above as one continuous card with an internal seam; exact spacing utility
values may be adjusted during implementation to match real rendering — the
requirement is "reads as one box, bottom row is clearly clickable.")

### 4.2 Label/heading renames (consistency, same Title Case rule)

| File | Change |
|------|--------|
| `app/projects/[id]/normalize/page.tsx` | `<h1>` text: "Normalize activity names" → **Task Naming** |
| `app/projects/[id]/completeness/page.tsx` | `<h1>` text: "Completeness" → **Task Granularity** |
| `app/projects/[id]/updates/page.tsx` | `<h1>` text: "Weekly updates" → **Progress Update** |
| `app/projects/[id]/import/page.tsx` | `<h1>` text: "Import schedule (MS Project XML)" → **Import Schedule (MS Project XML)** |
| `app/projects/[id]/health/page.tsx` | `<h1>` text: "Schedule health" → **Schedule Health** (page itself otherwise unchanged — still has the Progress section and 4 issue-check sections) |
| `app/projects/[id]/export/page.tsx`, `app/projects/[id]/trades/page.tsx` | No change — already correctly cased |

### 4.3 `components/WizardBanner.tsx`

Update the `STEPS` array labels (lines 3-7) to match the renames so the
"step X of 3: <label>" banner text stays consistent with the pages it
links to:

```tsx
const STEPS = [
  { path: "health", label: "Schedule Health" },
  { path: "normalize", label: "Task Naming" },
  { path: "completeness", label: "Task Granularity" },
] as const;
```

Paths are unchanged — only the display `label` strings change.

---

## 5. Testing

No component-rendering tests exist in this repo for page-level UI (consistent
with the wbs-visuals slice). Verification is build + manual:

- **Build** — `npm run build` (type-checks the new `getScheduleHealth` import
  and JSX changes).
- **Smoke (manual):** open a project dashboard with an imported schedule —
  confirm the header shows 6 flat pill buttons in the new order/labels with
  one teal primary; confirm the metadata box now shows a second clickable row
  with the 4 progress numbers; click it and confirm it lands on
  `/projects/[id]/health` showing "Schedule Health" and the 4 issue-check
  sections unchanged; confirm the first-time-setup wizard banner (new project,
  `?wizard=1`) shows "Task Naming" / "Task Granularity" at the right steps;
  confirm a project with no import yet still renders the header without
  the metrics row.

---

## 6. Non-Goals (this slice)

- Any visual grouping/box/divider around the setup-related actions —
  explicitly tried and rejected during brainstorming.
- Icons on nav buttons — considered (theme direction B) and not chosen.
- Changing any route path, page content/behavior beyond the `<h1>` text, or
  the health page's issue-check logic.
- Reworking `ActivityTable`, WBS section colors, or any other component
  outside this header/metadata-box scope.
- A two-column/sidebar page layout — metrics merge into the existing
  single-column metadata box instead.

---

## 7. Dependencies & Compatibility

- **Depends on:** `getScheduleHealth` (`lib/health/healthService.ts`),
  `summarizeProgress`/`ProgressSummary` (`lib/health/dateChecks.ts`) — both
  already used unchanged by the health page; this just calls the same
  service function from one more place.
- **No schema change. No new tables, routes, or API endpoints.**
- **No effect on:** ActivityTable/WBS visuals (slice from 2026-06-22 earlier
  today), Normalize/Completeness/Trades/Export/Import page internals, the
  weekly-update editor.
