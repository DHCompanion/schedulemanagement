# Schedule Management Tool — Slice 5g Design Spec (Trades Review UX: Dismiss + Bulk Assign)

**Date:** 2026-06-23
**Status:** Design approved; ready for implementation planning
**Owner:** Skiles Group (AJ Woodyard)
**Location:** `/home/coder/projects/Skilesconnect/schedulemanagement`
**Builds on:** Slice 5b (Trade Attribution — `TradeDictionaryEntry`, `ProjectTradeAssignment`, `TradesPanel`). Also draws precedent from Slice 5c (Completeness/`CompletenessDismissal`).

---

## 1. Slice Goal

The Trades screen's "scope → discipline" review list mixes two kinds of
unmapped scopes with no way to tell them apart in the UI or act on them
differently:

- Administrative/non-trade scopes (e.g. Mobilization, Submittals, Punch List)
  that will **never** need a discipline.
- Legitimate trade scopes that are just too coarse to classify yet.

There is currently no way to remove a scope from the review list, so the list
never narrows. Reviewing scopes is also strictly one-at-a-time, which doesn't
scale once a project has more than a handful of unmapped scopes.

This slice adds:
1. **Dismiss** — per-project, reversible exclusion of a scope from the
   unmapped-review list.
2. **Bulk-assign** — select several unmapped scopes and assign one discipline
   to all of them in one action.
3. **Tabbed restructure** of the Trades page so Assignment / Unmapped /
   Dismissed are visually separated instead of stacked on one long page.

No AI, no change to the global trade dictionary's meaning, no change to the
5a/5b attribution chain — this is purely a review-workflow improvement on top
of it.

---

## 2. Product Decisions (from brainstorming)

| Decision | Choice | Why |
|----------|--------|-----|
| Dismiss scope | **Per-project**, not global | The global trade dictionary already means "confirmed scope → discipline." Dismissal is a different, weaker claim ("not needed *here*") and must not leak across projects — a wrong call on one project shouldn't silently suppress the scope everywhere, unlike Slice 5c's `CompletenessDismissal`, which set this same precedent. |
| Dismiss visibility | **Visible "Dismissed" tab with one-click Restore** | Slice 5c's dismiss has no way to see or undo what's been dismissed — explicitly called out there as deferred. That gap is the exact risk being designed against here: an accidental dismissal of a scope that *does* need a trade must be recoverable. |
| Dismiss persistence model | New table, mirrors `CompletenessDismissal` | Consistent existing pattern; no reason to invent a different shape. |
| Bulk operation | **Multi-select + bulk-assign discipline only** (no bulk-dismiss) | The "too manual" complaint is specifically about assigning disciplines one row at a time. Dismiss stays single-row — it's a less frequent action and bulk-dismiss carries more risk of suppressing something that shouldn't be. |
| Bulk-assign mechanism | Frontend-only; reuses existing batched `POST /api/trades` | The endpoint already accepts an array of `{canonicalScope, discipline}` pairs. Bulk-assign just writes the same value into more rows of existing component state before the existing Save fires — no new endpoint. |
| Page structure | **Tabs**: "Trade Assignment", "Unmapped Activities", "Dismissed" | A single long page mixing three concerns (assign partner, review unmapped, see dismissed) was hard to scan. |
| Tab state | **Local component state**, not URL-driven | Simpler; this is a single-user review tool, not something that needs deep-linking to a specific tab. |
| Default tab | **Always "Trade Assignment"** | Consistent, predictable default regardless of project state. |

---

## 3. Data Model

One new table + migration. No changes to existing tables except a back-relation on `Project`.

```prisma
model TradeScopeDismissal {
  id             String   @id @default(cuid())
  projectId      String
  project        Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  canonicalScope String
  dismissedBy    String?
  createdAt      DateTime @default(now())

  @@unique([projectId, canonicalScope])
  @@index([projectId])
}
```

Keyed on `canonicalScope`, not a specific activity — the Trades page already
dedupes to distinct canonical scopes present on the project before building
the unmapped-review list (`applyTradeDictionaryWith`), so dismissal operates
at the same granularity the list is already shown at.

Back-relation added: `Project.tradeScopeDismissals TradeScopeDismissal[]`.

Forward-compat: portable cuid IDs, dated rows, `dismissedBy` string deferring
real actor identity — consistent with prior slices.

---

## 4. Service Layer (DB)

`lib/trades/tradesService.ts` additions:

```typescript
export async function dismissScope(projectId: string, canonicalScope: string, dismissedBy?: string): Promise<void>
// upsert TradeScopeDismissal by [projectId, canonicalScope]; idempotent.

export async function restoreScope(projectId: string, canonicalScope: string): Promise<void>
// deleteMany TradeScopeDismissal where [projectId, canonicalScope]; no-op if absent.

export async function getDismissedScopes(projectId: string): Promise<string[]>
// distinct canonicalScope values dismissed for this project, newest first.
```

In `app/projects/[id]/trades/page.tsx`, after computing `unmappedScopes` from
`applyTradeDictionaryWith`, subtract the project's dismissed-scope set before
building `disciplineRows` — the same filter-after-compute shape
`completenessService.getCompleteness` already uses for
`CompletenessDismissal`. `getDismissedScopes` also feeds the new Dismissed
tab.

---

## 5. Routes

Two new routes alongside the existing `app/api/trades/route.ts`, same shape
(plain `NextResponse.json`, 422 on a missing required field, `POST` for both
— no `DELETE` verb, consistent with how `/api/completeness/dismiss` is also a
`POST`):

- **`app/api/trades/dismiss/route.ts`** — `POST { projectId, canonicalScope }`
  → `dismissScope` → `{ ok: true }` / `{ error }` 422.
- **`app/api/trades/restore/route.ts`** — `POST { projectId, canonicalScope }`
  → `restoreScope` → `{ ok: true }` / `{ error }` 422.

No changes to the existing `POST /api/trades` route — bulk-assign reuses it
as-is.

---

## 6. Page & Component Changes

### 6.1 `app/projects/[id]/trades/page.tsx`
- Computes `unmappedScopes` as today, then filters out dismissed scopes
  (`getDismissedScopes(project.id)`) before building `disciplineRows`.
- Also fetches the dismissed list and passes it to `TradesPanel` as a new
  `dismissedScopes: { canonicalScope: string }[]` prop.

### 6.2 `components/TradesPanel.tsx` (client) — tabbed restructure
- New local state: `tab: "assignment" | "unmapped" | "dismissed"`, default
  `"assignment"`.
- Tab strip at the top with three buttons, each showing a count badge (e.g.
  "Unmapped Activities (4)", "Dismissed (2)").
- Error banner moves above the tab strip — shared across all actions
  (assign-save, dismiss, restore) regardless of which tab is active, reusing
  the existing `error` state.
- **Trade Assignment tab** — today's discipline → partner section, unchanged
  content. Its own "Save" button.
- **Unmapped Activities tab** — the scope → discipline review list, with:
  - A checkbox per row (new `selected: Set<string>` state, keyed by
    `canonicalScope`).
  - A bulk-action bar that appears when `selected.size > 0`: a discipline
    input (same `datalist` autocomplete as the per-row input) + "Apply to N
    selected" button. On click, writes the chosen discipline into `disc[scope]`
    for every selected scope — the same state the per-row input and
    suggestion buttons already write to.
  - Per-row: existing suggestion buttons + free-text input, plus a new
    "Dismiss" button. Dismiss is an **immediate** action (not batched with
    Save): `POST /api/trades/dismiss`, then `router.refresh()` — mirrors
    `CompletenessIssuesTable.dismiss()`. This is intentionally a different
    interaction model from discipline-assignment (batched via the existing
    Save), since dismiss and assign are different intents (exclude vs.
    classify) and conflating them in one save was part of the original
    confusion.
  - Its own "Save" button (same `save()` function as the Assignment tab —
    it already only submits non-empty entries from `disc`/`comp`, so saving
    from either tab persists pending edits in both without requiring a tab
    switch).
- **Dismissed tab** — list of dismissed scopes, each with a "Restore" button:
  `POST /api/trades/restore`, then `router.refresh()`.

---

## 7. Telemetry Profile

**Explicit opt-out**, consistent with Slice 5b. Revisit trigger: same as 5b —
a telemetry system landing makes dismiss/restore/bulk-assign natural
learning-signal events.

---

## 8. Testing

- **DB-gated (`tests/trades/tradesService.test.ts`)**:
  - `dismissScope` creates a row; calling it twice for the same
    `[projectId, canonicalScope]` is idempotent (no duplicate, no error).
  - `restoreScope` deletes the row; calling it when no dismissal exists is a
    no-op.
  - `getDismissedScopes` returns only the calling project's dismissals — a
    scope dismissed on project A must still appear unmapped on project B
    (mirrors `completenessService.test.ts`'s "scopes dismissal per project"
    case).
- **DB-gated (route)**: `POST /api/trades/dismiss` and
  `POST /api/trades/restore` persist/remove correctly; missing `projectId` or
  `canonicalScope` → 422.
- **Build**: trades page + panel compile with the new tabbed structure; new
  routes present.
- **Smoke (manual)**: open Trades on a project with unmapped scopes → switch
  tabs → select several unmapped scopes, bulk-assign one discipline, Save →
  they move out of Unmapped → Dismiss one scope → it disappears from Unmapped
  and appears in Dismissed → Restore it → it reappears in Unmapped → confirm
  a scope dismissed on this project still shows as unmapped on a different
  project sharing that scope.

---

## 9. Non-Goals (later)

- Bulk-dismiss (multi-select dismiss) — deferred; single-row dismiss only for
  now, per the explicit decision to keep dismiss lower-risk than assignment.
- A "reason" field on dismissal — the Dismissed tab + Restore already provide
  the safety net; a forced reason wasn't requested.
- URL-driven tab state / deep-linking to a specific tab.
- Any change to the global `TradeDictionaryEntry` semantics or the 5a/5b
  attribution chain.
- Surfacing dismissed-scope counts/state outside the Trades page (e.g. on a
  project dashboard).

---

## 10. Dependencies & Compatibility

- **Depends on:** Slice 5b (`TradeDictionaryEntry`, `applyTradeDictionaryWith`,
  `TradesPanel`, `POST /api/trades`).
- **Reuses:** the Slice 5c `CompletenessDismissal` pattern (per-project
  dismissal table, filter-after-compute), and the existing batched-save
  pattern from `TradesPanel.save()`.
- **Schema change:** one new table (`TradeScopeDismissal`) + migration,
  committed together with the schema change per repo convention.

---

## 11. Open Questions / Future Notes

- If bulk-dismiss turns out to be needed later (e.g. a project has many
  administrative scopes), revisit with the same multi-select UI already built
  for bulk-assign, routed to dismiss instead.
- Roster/dictionary hygiene (near-duplicate scopes) is unchanged from 5b and
  still future work, not addressed here.
