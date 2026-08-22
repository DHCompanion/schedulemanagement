# "Completed as Planned" Status Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user mark a weekly-update activity row "Completed as planned" in one action, auto-filling Actual Start, Actual Finish, and % Complete from the activity's planned dates.

**Architecture:** Single client-component change. Add a 4th `<option>`, `"completed_as_planned"`, to each row's Status `<select>` in `components/LookaheadUpdateForm.tsx`. It is a UI-only status value — the row's local state can hold it (so the dropdown keeps displaying "Completed as Planned" after selection) but it is translated to `"complete"` only at save time, in the `entries` payload the existing `save()` already POSTs. No schema change, no new API route.

**Tech Stack:** Next.js 14 App Router, React client component (`"use client"`), Tailwind classes matching existing rows.

## Global Constraints

- No schema or API changes — this is a pure client-side state patch using data already loaded onto each row (`plannedStart`/`plannedFinish` are already `YYYY-MM-DD` strings or `null`, per `app/projects/[id]/updates/[updateId]/page.tsx`'s `isoDay()` mapping).
- The dropdown must keep displaying "Completed as Planned" after it's selected (not snap back to "Complete") — so `LookaheadFormRow["status"]` widens to include `"completed_as_planned"` as a fourth, UI-only value. The value actually POSTed to `/api/updates/[updateId]/entries` (and therefore everything downstream, including `lib/export/injectActuals.ts`, which branches on this exact field) must still be `"complete"` — the `save()` function's `entries` mapping converts it at the boundary.
- Match this codebase's existing convention: client panel/form components (e.g. `CompletenessIssuesTable.tsx`, `ExportPanel.tsx`) have no dedicated unit tests — correctness is verified via `npm run build` plus a manual smoke test, not Vitest.

---

### Task 1: Add the "Completed as planned" option to `LookaheadUpdateForm`

**Files:**
- Modify: `components/LookaheadUpdateForm.tsx`

**Interfaces:**
- Consumes: existing `patch(i: number, p: Partial<LookaheadFormRow>)` helper (already defined at line 36-38) and the existing `LookaheadFormRow` fields `plannedStart: string | null`, `plannedFinish: string | null`, `status`, `actualStart: string`, `actualFinish: string`, `percentComplete: number | null`.
- Produces: no new exports — this is a self-contained UI change within the existing component.

No automated test for this task — matches the existing convention that client form/panel components in this codebase (`CompletenessIssuesTable.tsx`, `ExportPanel.tsx`) have no dedicated unit tests. Correctness is covered by `npm run build` plus the manual smoke test in Step 3.

- [ ] **Step 1: Widen the status type**

In `components/LookaheadUpdateForm.tsx`, change the `LookaheadFormRow.status` field:

```tsx
  status: "not_started" | "in_progress" | "complete" | "completed_as_planned";
```

(This is a UI-only widening — server-loaded rows only ever populate the first three values; `"completed_as_planned"` is set locally, never read from the database.)

- [ ] **Step 2: Convert to "complete" at save time**

In the `save()` function, find:

```tsx
    const entries = data.map((r) => ({
      activityExternalUid: r.externalUid,
      canonicalActivityKey: r.canonicalActivityKey,
      status: r.status,
      actualStart: r.actualStart || null,
```

Replace the `status` line with:

```tsx
      status: r.status === "completed_as_planned" ? "complete" : r.status,
```

This is the only place `r.status` reaches the network — every downstream consumer (the entries API, `lib/export/injectActuals.ts`) only ever sees `"complete"`.

- [ ] **Step 3: Add the change handler and the new option**

Find the Status `<select>` (currently lines 83-87):

```tsx
              <select disabled={readOnly} value={r.status} onChange={(e) => patch(i, { status: e.target.value as LookaheadFormRow["status"] })} className="rounded border border-slate-300 px-2 py-1 text-sm" aria-label="Status">
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="complete">Complete</option>
              </select>
```

Replace it with:

```tsx
              <select
                disabled={readOnly}
                value={r.status}
                onChange={(e) => {
                  const value = e.target.value as LookaheadFormRow["status"];
                  if (value === "completed_as_planned") {
                    patch(i, {
                      status: "completed_as_planned",
                      actualStart: r.plannedStart ?? "",
                      actualFinish: r.plannedFinish ?? "",
                      percentComplete: 100,
                    });
                    return;
                  }
                  patch(i, { status: value });
                }}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                aria-label="Status"
              >
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="complete">Complete</option>
                <option value="completed_as_planned" disabled={!r.plannedStart || !r.plannedFinish}>
                  Completed as Planned
                </option>
              </select>
```

Because `r.status` can now genuinely hold `"completed_as_planned"`, the select's bound `value` matches that option after selection, so the dropdown keeps reading "Completed as Planned" — it does not snap back to "Complete" the way it would if the patch wrote `status: "complete"` directly. The `disabled` attribute on the `<option>` greys it out (and makes it unselectable) whenever the row has no planned start or no planned finish to copy. After a save + page reload, the row will show "Complete" instead, since the database only ever stores `"complete"` (no schema change) — only the live, unsaved session preserves the "Completed as Planned" label.

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 5: Manual smoke test**

1. Start the dev server: `npm run dev`.
2. Open a project's weekly update draft (`/projects/<id>/updates/<updateId>`) that has at least one activity with both a planned start and planned finish, and at least one activity missing one of those (e.g. an unscheduled task, if any exist in your test data — otherwise this case is exercised by the build-time logic alone).
3. On a row with both planned dates: open the Status dropdown, confirm "Completed as Planned" is present and selectable; select it. Confirm Actual Start and Actual Finish inputs now show the row's planned dates, % Complete shows 100, and the dropdown still reads "Completed as Planned" (not "Complete").
4. Confirm the row's fields are still editable afterward (e.g. nudge the % Complete down to 95) — selecting the option only pre-fills, it doesn't lock the fields.
5. On a row missing a planned start or finish, open the dropdown and confirm "Completed as Planned" is greyed out / unselectable.
6. Click "Save draft", reload the page, confirm the values persisted (status now reads "Complete" since that's what the database stores, plus the copied dates and 100% or your edited value).

- [ ] **Step 6: Commit**

```bash
git add components/LookaheadUpdateForm.tsx
git commit -m "feat(updates): add a Completed as planned status option"
```
