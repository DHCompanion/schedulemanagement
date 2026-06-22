# "Completed as Planned" Status Option Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user mark a weekly-update activity row "Completed as planned" in one action, auto-filling Actual Start, Actual Finish, and % Complete from the activity's planned dates.

**Architecture:** Single client-component change. Add a 4th `<option>` to each row's Status `<select>` in `components/LookaheadUpdateForm.tsx`. It is not a real persisted status — selecting it triggers a one-time patch of `status`, `actualStart`, `actualFinish`, and `percentComplete` on that row's local state, reusing the existing `patch()` helper. No schema change, no new API route; the existing `save()`/entries POST already sends these four fields.

**Tech Stack:** Next.js 14 App Router, React client component (`"use client"`), Tailwind classes matching existing rows.

## Global Constraints

- No schema or API changes — this is a pure client-side state patch using data already loaded onto each row (`plannedStart`/`plannedFinish` are already `YYYY-MM-DD` strings or `null`, per `app/projects/[id]/updates/[updateId]/page.tsx`'s `isoDay()` mapping).
- The persisted `status` value selecting this option produces must be `"complete"` — the existing `LookaheadFormRow["status"]` type only allows `"not_started" | "in_progress" | "complete"`, and export logic (`lib/export/injectActuals.ts`) branches on this exact field.
- Match this codebase's existing convention: client panel/form components (e.g. `CompletenessIssuesTable.tsx`, `ExportPanel.tsx`) have no dedicated unit tests — correctness is verified via `npm run build` plus a manual smoke test, not Vitest.

---

### Task 1: Add the "Completed as planned" option to `LookaheadUpdateForm`

**Files:**
- Modify: `components/LookaheadUpdateForm.tsx`

**Interfaces:**
- Consumes: existing `patch(i: number, p: Partial<LookaheadFormRow>)` helper (already defined at line 36-38) and the existing `LookaheadFormRow` fields `plannedStart: string | null`, `plannedFinish: string | null`, `status`, `actualStart: string`, `actualFinish: string`, `percentComplete: number | null`.
- Produces: no new exports — this is a self-contained UI change within the existing component.

No automated test for this task — matches the existing convention that client form/panel components in this codebase (`CompletenessIssuesTable.tsx`, `ExportPanel.tsx`) have no dedicated unit tests. Correctness is covered by `npm run build` plus the manual smoke test in Step 3.

- [ ] **Step 1: Add the change handler and the new option**

In `components/LookaheadUpdateForm.tsx`, find the Status `<select>` (currently lines 83-87):

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
                  if (e.target.value === "completed_as_planned") {
                    patch(i, {
                      status: "complete",
                      actualStart: r.plannedStart ?? "",
                      actualFinish: r.plannedFinish ?? "",
                      percentComplete: 100,
                    });
                    return;
                  }
                  patch(i, { status: e.target.value as LookaheadFormRow["status"] });
                }}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                aria-label="Status"
              >
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="complete">Complete</option>
                <option value="completed_as_planned" disabled={!r.plannedStart || !r.plannedFinish}>
                  Completed as planned
                </option>
              </select>
```

This works because `value="completed_as_planned"` is never the select's bound `value` (`r.status` is always one of the three real statuses) — picking it fires `onChange` once, the handler patches the row to `status: "complete"` with the copied dates and 100%, and on the next render the select redisplays as "Complete" since `r.status` is now `"complete"`. The `disabled` attribute on the `<option>` greys it out (and makes it unselectable) whenever the row has no planned start or no planned finish to copy.

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 3: Manual smoke test**

1. Start the dev server: `npm run dev`.
2. Open a project's weekly update draft (`/projects/<id>/updates/<updateId>`) that has at least one activity with both a planned start and planned finish, and at least one activity missing one of those (e.g. an unscheduled task, if any exist in your test data — otherwise this case is exercised by the build-time logic alone).
3. On a row with both planned dates: open the Status dropdown, confirm "Completed as planned" is present and selectable; select it. Confirm Actual Start and Actual Finish inputs now show the row's planned dates, % Complete shows 100, and the dropdown now reads "Complete".
4. Confirm the row's fields are still editable afterward (e.g. nudge the % Complete down to 95) — selecting the option only pre-fills, it doesn't lock the fields.
5. On a row missing a planned start or finish, open the dropdown and confirm "Completed as planned" is greyed out / unselectable.
6. Click "Save draft", reload the page, confirm the values persisted (status "Complete", the copied dates, 100% or your edited value).

- [ ] **Step 4: Commit**

```bash
git add components/LookaheadUpdateForm.tsx
git commit -m "feat(updates): add a Completed as planned status option"
```
