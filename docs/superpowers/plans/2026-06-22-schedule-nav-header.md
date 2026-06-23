# Schedule Nav Header Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle and relabel the project dashboard's nav header (`app/projects/[id]/page.tsx`) from 7 crowded, inconsistently-capitalized buttons into 6 flat muted-pill buttons with one primary action, remove "Schedule health" from the header, and merge its 4 progress metrics into the existing import-metadata box as a clickable link through to the (unchanged) full health page.

**Architecture:** Pure presentational change to one Next.js server component page plus five one-line heading renames on sibling pages and one labels-array rename in a shared banner component. No schema, route, or business-logic changes. The only new data dependency is calling the existing `getScheduleHealth()` service function (already used by the health page) from the dashboard page to source the 4 metrics.

**Tech Stack:** Next.js 14 App Router (server components), TypeScript strict mode, Tailwind CSS, Prisma.

## Global Constraints

- TypeScript strict mode — no `any`. (repo-wide, `/home/coder/projects/CLAUDE.md`)
- No dead code — remove unused variables/exports/imports. (repo-wide)
- Preserve existing UI and behavior unless explicitly asked to change it — this plan's explicit scope is the header, metadata box, and the 6 listed headings/labels only. (`Skilesconnect/CLAUDE.md`)
- `npm run build` and `npm run test` must pass before this is considered done. (`Skilesconnect/CLAUDE.md`)
- Title Case on every nav label and every touched page `<h1>`: capitalize all words except short function words ("to", "a", "of"); acronyms (MS) stay fully capped. (spec §3)
- No visual grouping/box/divider around any subset of the 6 header buttons — flat row only. (spec §3, explicitly rejected during brainstorming)
- Routes (`/normalize`, `/completeness`, `/updates`, `/export`, `/import`, `/health`) are unchanged — only visible label/class/heading text changes. (spec §4.1, §4.2)

---

## File Structure

- **Modify** `app/projects/[id]/page.tsx` — header button row (restyle, relabel, reorder, drop health link) and the metadata box (add health-metrics second row). This is the only file with logic changes (one new service call).
- **Modify** `app/projects/[id]/normalize/page.tsx` — `<h1>` text only.
- **Modify** `app/projects/[id]/completeness/page.tsx` — `<h1>` text only.
- **Modify** `app/projects/[id]/updates/page.tsx` — `<h1>` text only.
- **Modify** `app/projects/[id]/import/page.tsx` — `<h1>` text only.
- **Modify** `app/projects/[id]/health/page.tsx` — `<h1>` text only.
- **Modify** `components/WizardBanner.tsx` — `STEPS` array `label` fields only (`path` values unchanged).

No new files. No test files — this repo has no component-rendering test infra (no `@testing-library/react`/jsdom; confirmed in the 2026-06-22 wbs-visuals spec and still true), so verification for every task below is `npm run build` (type-check) plus a manual smoke step, matching the pattern used in that prior slice.

---

### Task 1: Restyle, relabel, and reorder the header button row

**Files:**
- Modify: `app/projects/[id]/page.tsx:46-71`

**Interfaces:**
- Consumes: nothing new — same `project.id` already in scope.
- Produces: nothing consumed by later tasks (Task 2 touches a different, adjacent block in the same file but doesn't depend on this task's specific markup).

Current code at `app/projects/[id]/page.tsx:46-71`:

```tsx
      <div className="mb-4 mt-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <div className="flex gap-2">
          <Link href={`/projects/${project.id}/health`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Schedule health
          </Link>
          <Link href={`/projects/${project.id}/normalize`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Normalize activity names
          </Link>
          <Link href={`/projects/${project.id}/completeness`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Completeness
          </Link>
          <Link href={`/projects/${project.id}/trades`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Trades
          </Link>
          <Link href={`/projects/${project.id}/updates`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Weekly updates
          </Link>
          <Link href={`/projects/${project.id}/export`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Export to MS Project
          </Link>
          <Link href={`/projects/${project.id}/import`} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            Import schedule
          </Link>
        </div>
      </div>
```

- [ ] **Step 1: Replace the block with the restyled, relabeled, reordered version**

Replace the exact block above (lines 46-71) with:

```tsx
      <div className="mb-4 mt-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/projects/${project.id}/normalize`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Task Naming
          </Link>
          <Link href={`/projects/${project.id}/completeness`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Task Granularity
          </Link>
          <Link href={`/projects/${project.id}/trades`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Trades
          </Link>
          <Link href={`/projects/${project.id}/updates`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Progress Update
          </Link>
          <Link href={`/projects/${project.id}/export`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Export to MS Project
          </Link>
          <Link href={`/projects/${project.id}/import`} className="rounded-lg bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-800">
            Import Schedule
          </Link>
        </div>
      </div>
```

Note the `Schedule health` link is deleted entirely (Task 2 reintroduces those metrics elsewhere on the page, not in this row).

- [ ] **Step 2: Type-check**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Manual smoke check**

Start the dev server (`npm run dev`) if not already running, open any project dashboard at `/projects/[id]`, and confirm:
- 6 buttons render in this order: Task Naming, Task Granularity, Trades, Progress Update, Export to MS Project, Import Schedule.
- The first 5 are white/outlined; "Import Schedule" is the only solid (teal) button.
- There is no visual box, background tint, or divider grouping any subset of the 6 buttons — just even gaps.
- No "Schedule health" button appears anywhere in this row.

- [ ] **Step 4: Commit**

```bash
git add app/projects/\[id\]/page.tsx
git commit -m "$(cat <<'EOF'
feat(schedule): restyle and relabel the dashboard nav header

Replaces the 7-button bordered/black-primary row with a flat row of
6 muted ghost-pill buttons and one teal primary action, using
consistent Title Case labels. Schedule health is dropped from this
row entirely (its metrics move into the metadata box in the next task).
EOF
)"
```

---

### Task 2: Merge Schedule Health's 4 progress metrics into the import-metadata box

**Files:**
- Modify: `app/projects/[id]/page.tsx:1-7` (imports), `:78-90` (data fetch + metadata box)

**Interfaces:**
- Consumes: `getScheduleHealth(projectId: string): Promise<ScheduleHealth>` from `@/lib/health/healthService`, where `ScheduleHealth.progress` is `{ total: number; completed: number; remaining: number; percentComplete: number }` and `ScheduleHealth.hasImport: boolean` (both already defined and exported; used unchanged by `app/projects/[id]/health/page.tsx:4,22`).
- Produces: nothing consumed by later tasks.

Current imports at `app/projects/[id]/page.tsx:1-7`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ActivityTable, type ActivityRow } from "@/components/ActivityTable";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";
```

Current data fetch and metadata box at `app/projects/[id]/page.tsx:78-90` (line numbers shift by the net diff from Task 1 — locate by the unique `currentProgress` and `latest.fileName` content if line numbers have drifted):

```tsx
  const currentProgress = resolveCurrentProgress(await getFinalizedEntries(project.id));
```

and further down:

```tsx
      {!latest ? (
        <p className="text-slate-500">No schedule imported yet.</p>
      ) : (
        <>
          <div className="mb-4 rounded border border-slate-200 bg-white p-3 text-sm text-slate-600">
            <div>File: {latest.fileName}</div>
            <div>Imported: {latest.importedAt.toISOString().slice(0, 16).replace("T", " ")}</div>
            <div>Status date: {latest.statusDate ? latest.statusDate.toISOString().slice(0, 10) : "—"}</div>
            <div>{latest.isBaseline ? "Baseline import" : "Update import"} · {latest.activityCount} activities · {latest.relationshipCount} relationships</div>
          </div>
          <ActivityTable rows={rows} />
        </>
      )}
```

- [ ] **Step 1: Add the `getScheduleHealth` import**

Add to the import block (after the `getFinalizedEntries` import):

```tsx
import { getScheduleHealth } from "@/lib/health/healthService";
```

- [ ] **Step 2: Fetch health alongside the existing data**

Immediately after the existing `const currentProgress = resolveCurrentProgress(...)` line, add:

```tsx
  const health = await getScheduleHealth(project.id);
```

- [ ] **Step 3: Add the clickable metrics row directly below the metadata box**

`latest` (truthy in this branch) and `health` always come from the same
"most recent import" query, so `health.hasImport` is true whenever `latest`
is — the `health.hasImport` check below is defensive, not an expected-false
branch, but the metadata box still needs its own bottom margin in case it
ever is false. Replace:

```tsx
          <div className="mb-4 rounded border border-slate-200 bg-white p-3 text-sm text-slate-600">
            <div>File: {latest.fileName}</div>
            <div>Imported: {latest.importedAt.toISOString().slice(0, 16).replace("T", " ")}</div>
            <div>Status date: {latest.statusDate ? latest.statusDate.toISOString().slice(0, 10) : "—"}</div>
            <div>{latest.isBaseline ? "Baseline import" : "Update import"} · {latest.activityCount} activities · {latest.relationshipCount} relationships</div>
          </div>
          <ActivityTable rows={rows} />
```

with:

```tsx
          <div className={`rounded border border-slate-200 bg-white p-3 text-sm text-slate-600 ${health.hasImport ? "border-b-0" : "mb-4"}`}>
            <div>File: {latest.fileName}</div>
            <div>Imported: {latest.importedAt.toISOString().slice(0, 16).replace("T", " ")}</div>
            <div>Status date: {latest.statusDate ? latest.statusDate.toISOString().slice(0, 10) : "—"}</div>
            <div>{latest.isBaseline ? "Baseline import" : "Update import"} · {latest.activityCount} activities · {latest.relationshipCount} relationships</div>
          </div>
          {health.hasImport && (
            <Link
              href={`/projects/${project.id}/health`}
              className="mb-4 flex flex-wrap gap-4 rounded border border-t-0 border-slate-200 bg-white p-3 text-sm text-slate-600 hover:bg-slate-50"
            >
              <div><span className="font-medium">{health.progress.total}</span> total</div>
              <div><span className="font-medium">{health.progress.completed}</span> completed</div>
              <div><span className="font-medium">{health.progress.remaining}</span> remaining</div>
              <div><span className="font-medium">{health.progress.percentComplete}%</span> complete</div>
            </Link>
          )}
          <ActivityTable rows={rows} />
```

- [ ] **Step 4: Type-check**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors (confirms `ScheduleHealth`/`progress` field names match).

- [ ] **Step 5: Manual smoke check**

Open a project dashboard with an imported schedule and confirm:
- The existing file/imported/status-date box and a new row below it (Total/Completed/Remaining/% complete) appear visually fused as one card.
- Hovering the bottom (metrics) row shows a background change; hovering the top (file info) row does not.
- Clicking anywhere in the metrics row navigates to `/projects/[id]/health`.
- On a project with no schedule imported yet, the page still renders the "No schedule imported yet." message with no errors (this branch is gated by the outer `!latest` check and untouched by this task, but confirm no regression).

- [ ] **Step 6: Commit**

```bash
git add app/projects/\[id\]/page.tsx
git commit -m "$(cat <<'EOF'
feat(schedule): merge Schedule Health metrics into the metadata box

Schedule health no longer has its own nav button; its 4 progress
metrics (total/completed/remaining/% complete) now render as a
clickable second row fused to the existing import-metadata box,
linking through to the unchanged full health page.
EOF
)"
```

---

### Task 3: Rename page headings and the wizard banner labels for consistency

**Files:**
- Modify: `app/projects/[id]/normalize/page.tsx:46`
- Modify: `app/projects/[id]/completeness/page.tsx:19`
- Modify: `app/projects/[id]/updates/page.tsx:22`
- Modify: `app/projects/[id]/import/page.tsx:17`
- Modify: `app/projects/[id]/health/page.tsx:27`
- Modify: `components/WizardBanner.tsx:3-7`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks (final task in this plan).

- [ ] **Step 1: Rename the Normalize page heading**

In `app/projects/[id]/normalize/page.tsx:46`, replace:

```tsx
      <h1 className="mb-1 mt-1 text-xl font-semibold">Normalize activity names</h1>
```

with:

```tsx
      <h1 className="mb-1 mt-1 text-xl font-semibold">Task Naming</h1>
```

- [ ] **Step 2: Rename the Completeness page heading**

In `app/projects/[id]/completeness/page.tsx:19`, replace:

```tsx
      <h1 className="mb-1 mt-1 text-xl font-semibold">Completeness</h1>
```

with:

```tsx
      <h1 className="mb-1 mt-1 text-xl font-semibold">Task Granularity</h1>
```

- [ ] **Step 3: Rename the Weekly updates page heading**

In `app/projects/[id]/updates/page.tsx:22`, replace:

```tsx
      <h1 className="mb-4 mt-1 text-xl font-semibold">Weekly updates</h1>
```

with:

```tsx
      <h1 className="mb-4 mt-1 text-xl font-semibold">Progress Update</h1>
```

- [ ] **Step 4: Rename the Import page heading**

In `app/projects/[id]/import/page.tsx:17`, replace:

```tsx
      <h1 className="mb-4 mt-1 text-xl font-semibold">Import schedule (MS Project XML)</h1>
```

with:

```tsx
      <h1 className="mb-4 mt-1 text-xl font-semibold">Import Schedule (MS Project XML)</h1>
```

- [ ] **Step 5: Rename the Schedule Health page heading**

In `app/projects/[id]/health/page.tsx:27`, replace:

```tsx
      <h1 className="mb-1 mt-1 text-xl font-semibold">Schedule health</h1>
```

with:

```tsx
      <h1 className="mb-1 mt-1 text-xl font-semibold">Schedule Health</h1>
```

- [ ] **Step 6: Rename the wizard banner step labels**

In `components/WizardBanner.tsx:3-7`, replace:

```tsx
const STEPS = [
  { path: "health", label: "Schedule health" },
  { path: "normalize", label: "Normalize activity names" },
  { path: "completeness", label: "Completeness" },
] as const;
```

with:

```tsx
const STEPS = [
  { path: "health", label: "Schedule Health" },
  { path: "normalize", label: "Task Naming" },
  { path: "completeness", label: "Task Granularity" },
] as const;
```

- [ ] **Step 7: Type-check**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 8: Manual smoke check**

Visit `/projects/[id]/normalize`, `/projects/[id]/completeness`, `/projects/[id]/updates`, `/projects/[id]/import`, `/projects/[id]/health` directly and confirm each shows its new Title Case heading. Then visit `/projects/[id]/health?wizard=1` on a project still in first-time setup and confirm the wizard banner reads "First-time setup — step 1 of 3: Schedule Health", and that stepping to `/normalize?wizard=1` / `/completeness?wizard=1` shows "Task Naming" / "Task Granularity" respectively.

- [ ] **Step 9: Commit**

```bash
git add app/projects/\[id\]/normalize/page.tsx app/projects/\[id\]/completeness/page.tsx app/projects/\[id\]/updates/page.tsx app/projects/\[id\]/import/page.tsx app/projects/\[id\]/health/page.tsx components/WizardBanner.tsx
git commit -m "$(cat <<'EOF'
fix(schedule): rename page headings and wizard steps to match new nav labels

Keeps each destination's own heading and the first-time-setup wizard
banner consistent with the nav header's renamed, Title-Cased labels
(Task Naming, Task Granularity, Progress Update, Import Schedule,
Schedule Health).
EOF
)"
```

---

### Task 4: Full regression pass

**Files:** none (verification only)

**Interfaces:**
- Consumes: the completed state of Tasks 1-3.
- Produces: nothing — this is the plan's final check.

- [ ] **Step 1: Run the full build and test suite**

Run: `npm run build && npm run test`
Expected: both succeed with no errors.

- [ ] **Step 2: Full manual walkthrough**

On a project with an imported schedule:
- Header shows the 6 reordered, relabeled, restyled buttons with no grouping box.
- Metadata box + health-metrics row render as one fused, two-row card; clicking the bottom row opens Schedule Health.
- Each of the 6 destination pages (Task Naming, Task Granularity, Trades, Progress Update, Export to MS Project, Import Schedule) still loads correctly via its (unchanged) route and shows its renamed heading.
- The first-time-setup wizard (new project, no import yet) shows the renamed step labels at each of its 3 steps and still navigates Back/Next/Finish correctly.
- `ActivityTable` below the metadata box renders unaffected (confirms Tasks 1-2 didn't disturb sibling content).

No commit for this task — it's verification only. If anything fails, fix it as part of whichever task introduced the regression and re-run this task.
