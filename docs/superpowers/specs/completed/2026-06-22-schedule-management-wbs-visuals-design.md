# Schedule Management Tool — WBS Section Visuals Design Spec

**Date:** 2026-06-22
**Status:** Design approved; ready for implementation planning
**Owner:** Skiles Group (AJ Woodyard)
**Location:** `/home/coder/projects/Skilesconnect/schedulemanagement`
**Touches:** `components/ActivityTable.tsx` (project dashboard activity list, `app/projects/[id]/page.tsx`)

---

## 1. Context

The project dashboard's activity list (`ActivityTable`) renders every `Activity`
row — leaf tasks/milestones and WBS summary rows alike — as a flat, undifferentiated
list sorted by `wbsCode`. On a schedule with hundreds of activities across many
WBS sections, it's hard to tell where one section ends and the next begins, and
there's no way to collapse a section to focus on another. Separately, a fully
complete activity looks identical to an in-progress one except for a number in
the collapsed detail row — there's no at-a-glance "done" signal the way there
already is for milestones (the indigo "◆ milestone" badge).

This adds three purely visual/presentational behaviors to that one component:
WBS section header rows with cycling color, multi-level collapse, and a
"✓ Completed" badge. **No schema change, no new data** — `type` (`task` |
`milestone` | `summary` | `project_summary`), `wbsCode`, `outlineLevel`, and
`percentComplete` already exist on every `Activity` and already flow into
`ActivityRow`. This follows the same posture as 5c/5d/5e: a read-time overlay
over existing import data.

---

## 2. Goal

1. Render `type === "summary"` rows as colored header rows instead of plain
   list items, so WBS sections are visually distinct from each other and from
   their activities.
2. Let any summary row collapse/expand, hiding everything nested under it.
3. Show a green "✓ Completed" badge on any leaf row (`task`/`milestone`) with
   `percentComplete === 100`.

---

## 3. Product Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Collapse depth | **Every level.** Each summary row, at any depth, gets its own independent collapse toggle. Collapsing a parent hides its whole subtree regardless of descendants' own collapsed state. |
| Color scheme | **Distinct tinted background per top-level section** (outline level 1), cycling through a fixed 6-color Tailwind palette by sibling index, repeating past 6. Nested summary rows under a section inherit that section's hue at a lighter shade (two tiers: `-100` for the top-level row, `-50` for everything nested below it) — not a new color per depth. |
| Filtering | **Hide empty sections.** Existing search/filter (name/WBS/ID search; All/Milestones/Critical/In-progress) keeps matching only leaf rows. A summary row is included only if at least one of its descendant leaves still matches; otherwise it and its now-empty subtree are omitted. Summary rows are never themselves tested against the milestone/critical/in-progress filters. |
| Badge scope | **Leaf rows only.** No rollup "% of children complete" computation on summary rows — out of scope. |
| Badge vs. milestone badge | **Both show.** The "✓ Completed" badge is independent of `type`; a completed milestone shows both the indigo "◆ milestone" badge and the green "✓ Completed" badge. |
| `project_summary` row | **Excluded from rendering**, same as Normalize/Trades already exclude it from their leaf lists. The page title already names the project; a single all-encompassing header row adds nothing. |

---

## 4. Implementation

### 4.1 `lib/schedule/wbsGrouping.ts` (new, pure functions, no React/DOM)

Mirrors the existing stack-based parent-derivation pattern in
`lib/msp/hierarchy.ts` (`deriveParents`, keyed on document order + `outlineLevel`),
generalized to track the **full ancestor chain** per row rather than just the
immediate parent, since visibility needs "is any ancestor collapsed," not just
the nearest one:

```typescript
export interface OutlineRow {
  id: string;
  outlineLevel: number;
  type: string; // "task" | "milestone" | "summary" | "project_summary"
}

// Document-order rows (already sorted by wbsCode) -> id -> ordered ancestor
// ids (root-most first), using the same "nearest preceding row with a
// strictly smaller outlineLevel" rule as deriveParents.
export function deriveAncestorChains<T extends OutlineRow>(rows: T[]): Map<string, string[]>

// Among ancestor chains, the outlineLevel===1 ancestor id for a given row
// (or the row's own id if it IS an outlineLevel===1 summary). Used both for
// palette indexing and for the two-tier shade rule.
export function topSectionId(ancestors: string[], rows: OutlineRow[]): string | null

// True if `id` should be hidden given the current collapsed set — i.e. any
// entry in its ancestor chain is in `collapsed`.
export function isHiddenByCollapse(ancestorIds: string[], collapsed: Set<string>): boolean
```

Requires rows to already be in document order (parent immediately precedes
its descendants) — true today because `view` is sorted by `wbsCode` whenever
`sort === "wbs"`. Section header rendering is **disabled when `sort !== "wbs"`**
(start/float sort breaks WBS document order) — falls back to the current flat
list in that case; the sort selector is unaffected.

### 4.2 `components/ActivityTable.tsx`

- New state: `const [collapsed, setCollapsed] = useState<Set<string>>(new Set())`.
- After the existing `view` memo (search/filter/sort, unchanged), a second memo
  builds the render list:
  1. Drop `type === "project_summary"` rows.
  2. Compute `deriveAncestorChains(view)` once.
  3. When a search/filter is active (`q` non-empty or `filter !== "all"`),
     compute the set of leaf ids that still match (today's existing filter
     predicates, applied to leaves only), then keep a summary row only if
     `deriveAncestorChains` shows at least one matching leaf in its subtree
     (walk `view` for rows whose ancestor chain includes this summary's id).
  4. Drop rows where `isHiddenByCollapse(ancestors, collapsed)` is true.
- Top-level palette: fixed array of 6 `{ bg, nestedBg, text }` Tailwind class
  triples (indigo/amber/emerald/rose/sky/violet, `-100`/`-50`/`-700` shades),
  indexed by the sibling order of outline-level-1 summary rows (`% 6` past 6).
  A `Map<topSectionId, paletteEntry>` is built once per render list.
- Summary rows render as a header: collapse arrow (▾ expanded / ▸ collapsed,
  click toggles membership in `collapsed`), bold name, WBS code, count of
  currently-visible descendant leaves, full-row background from the palette
  (`-100` if this row IS the top-level section, `-50` if nested under one).
- Leaf rows render as today (`ActivityTable.tsx:76-100`), indented by
  `outlineLevel`, plus the new badge: alongside the existing
  `{a.type === "milestone" && ...}` check at line 82, add
  `{a.percentComplete === 100 && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">✓ Completed</span>}`.

No prop changes to `ActivityTable` — `rows: ActivityRow[]` already carries
everything needed.

---

## 5. Testing

No component-rendering tests exist in this repo (no `@testing-library/react`/
jsdom dependency) — existing tests are pure-function unit tests (e.g.
`tests/msp/hierarchy.test.ts`) and DB-gated integration tests. Follow that
pattern:

- **Unit** (`tests/schedule/wbsGrouping.test.ts`, new, no DB): given a small
  document-order row list with mixed `outlineLevel`/`type` (mirroring the
  `deriveParents` test fixture shape), verify `deriveAncestorChains` returns
  the correct root-to-parent chain for nested rows, `topSectionId` resolves
  to the right outline-level-1 ancestor at any depth, and
  `isHiddenByCollapse` is true only when an ancestor (not just the immediate
  parent) is in the collapsed set.
- **Build** — `npm run build` (type-checks `ActivityTable.tsx`).
- **Smoke (manual):** open a project dashboard with a multi-section schedule —
  confirm each top-level section has a distinct tinted header, nested
  sub-sections show the lighter shade of their parent's hue, collapsing a
  section hides its whole subtree, collapsing a sub-section while its parent
  stays expanded works independently, switching to Start/Float sort falls
  back to the flat list, searching/filtering hides sections with no matching
  leaves, and a 100%-complete milestone shows both badges.

---

## 6. Non-Goals (this slice)

- Rollup completion percentage or a completed badge on summary rows.
- Persisting collapse state across page reloads/navigation (in-memory only,
  same as the existing per-row `openId` detail expand).
- The weekly-update editor's WBS grouping (separate backlog item, separate
  component — `LookaheadUpdateForm.tsx`).
- Sticky/pinned section headers while scrolling.
- Configurable or user-chosen colors — the 6-color cycle is fixed.

---

## 7. Dependencies & Compatibility

- **Depends on:** existing `Activity.type`/`wbsCode`/`outlineLevel`/
  `percentComplete` fields (Slice 1+), the existing `wbsCode`-sort document
  order, `lib/msp/hierarchy.ts`'s `deriveParents` as the algorithmic pattern
  being mirrored (not reused directly — that one tracks immediate parent by
  numeric `externalUid`; this needs full ancestor chains by string row `id`).
- **No schema change.**
- **No effect on:** Health, Normalize, Completeness, Trades, Export, or the
  weekly-update editor — all read different components/queries.
