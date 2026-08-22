# AT RISK Explanation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, in an activity's expanded detail, what procurement actually says about that activity's trade partner — so the `AT RISK` pill stops being a verdict without a reason.

**Architecture:** A pure `describeProcurement()` turns the per-partner counts already cached in `OsProcurementRisk` into display strings. The project page widens its existing query (no new round trip) and attaches the counts to each activity row; `ActivityTable` renders them in the `<dl>` it already opens on tap.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma + PostgreSQL, Vitest + Testing Library + happy-dom, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-31-at-risk-explanation-design.md`

**No schema change, no migration, no gateway change.** Every field is already cached and currently unread.

## Global Constraints

- TypeScript strict — never `any`.
- No `console.log` in server-side code.
- The label reads **"This trade's procurement:"**, never just "Procurement:". Every number on the line is project-wide for that partner, not scoped to the activity tapped — the label has to carry that or the counts read as belonging to the row.
- **Do not display `earliestRequiredOnSite`.** It is cached and available, and deliberately withheld: it is the earliest across all that partner's items project-wide, so showing it beside an activity's start invites a comparison that is invalid at this grain.
- Counts are rendered as tallies with no singular/plural inflection — `1 submittal late`, not `1 submittal is late`. Confirmed by the repo owner.
- The line renders for **every** partner with a cached row, not only flagged ones. A partner whose items are all unassessable currently reads identically to one that is genuinely fine; that is the false negative this feature exists to close.
- The line renders regardless of the activity's percent complete. The pill is a call to action and is suppressed at 100%; the line is reference data about the trade and is not.
- Preserve existing UI and behavior beyond these changes.
- Run `npm run build` and `npm run test` before review. Baseline is 312/312 passing.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/trades/activityTrades.ts` | modify | `ActivityProcurement` type and the pure `describeProcurement` |
| `tests/trades/activityTrades.test.ts` | modify | Cover every branch of the describer |
| `app/projects/[id]/page.tsx` | modify | Widen the existing query, build the per-partner map, attach to rows |
| `components/ActivityTable.tsx` | modify | `ActivityRow.procurement`, render the block in the `<dl>` |
| `tests/components/ActivityTable.test.tsx` | modify | Row factory field, plus render assertions |

---

### Task 1: The describer

**Files:**
- Modify: `lib/trades/activityTrades.ts` (append, after `shouldShowProcurementRiskLine` which ends line 100)
- Test: `tests/trades/activityTrades.test.ts`

**Interfaces:**
- Produces: `export type ActivityProcurement` and
  `export function describeProcurement(p: ActivityProcurement): { headline: string; details: string[] }`.
  Task 2 depends on both by these exact names.

This task adds only new exports. Nothing existing changes, so no existing test breaks.

- [ ] **Step 1: Write the failing tests**

Append to `tests/trades/activityTrades.test.ts`. Add `describeProcurement` and the type to the import on line 2.

```ts
describe("describeProcurement", () => {
  const base = {
    itemCount: 9,
    behindCount: 0,
    submittalLateCount: 0,
    projectedLateCount: 0,
    releasedAtRiskCount: 0,
    missingDatesCount: 0,
  };

  it("leads with the behind count against the total", () => {
    const r = describeProcurement({ ...base, behindCount: 8, submittalLateCount: 7, projectedLateCount: 1 });
    expect(r.headline).toBe("8 of 9 items behind");
  });

  it("joins both lateness kinds into one line", () => {
    const r = describeProcurement({ ...base, behindCount: 8, submittalLateCount: 7, projectedLateCount: 1 });
    expect(r.details).toEqual(["7 submittal late, 1 projected late"]);
  });

  it("names only the lateness kind that applies", () => {
    const r = describeProcurement({ ...base, behindCount: 7, submittalLateCount: 7 });
    expect(r.details).toEqual(["7 submittal late"]);
    const p = describeProcurement({ ...base, behindCount: 2, projectedLateCount: 2 });
    expect(p.details).toEqual(["2 projected late"]);
  });

  it("says so plainly when nothing is behind", () => {
    expect(describeProcurement(base).headline).toBe("9 items, none behind");
    expect(describeProcurement(base).details).toEqual([]);
  });

  it("reports unassessable items even when nothing is behind", () => {
    // The state this whole feature exists to make visible: without this line a
    // partner whose every item lacks dates reads exactly like one that is fine.
    const r = describeProcurement({ ...base, itemCount: 6, missingDatesCount: 6 });
    expect(r.headline).toBe("6 items, none behind");
    expect(r.details).toEqual(["6 with no required-on-site date"]);
  });

  it("reports released-at-risk items alongside lateness", () => {
    const r = describeProcurement({
      ...base, behindCount: 1, projectedLateCount: 1, releasedAtRiskCount: 1,
    });
    expect(r.details).toEqual(["1 projected late", "1 released at risk"]);
  });

  it("orders details as lateness, then at-risk, then missing dates", () => {
    const r = describeProcurement({
      ...base, itemCount: 12, behindCount: 3, submittalLateCount: 2,
      projectedLateCount: 1, releasedAtRiskCount: 4, missingDatesCount: 5,
    });
    expect(r.details).toEqual([
      "2 submittal late, 1 projected late",
      "4 released at risk",
      "5 with no required-on-site date",
    ]);
  });

  it("handles a partner with no items", () => {
    const r = describeProcurement({ ...base, itemCount: 0 });
    expect(r.headline).toBe("0 items, none behind");
    expect(r.details).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/trades/activityTrades.test.ts`
Expected: FAIL — `describeProcurement` is not exported from `@/lib/trades/activityTrades`.

- [ ] **Step 3: Implement**

Append to `lib/trades/activityTrades.ts`:

```ts
/** Per-partner procurement tallies, as cached from the OS context packet. */
export type ActivityProcurement = {
  itemCount: number;
  behindCount: number;
  submittalLateCount: number;
  projectedLateCount: number;
  releasedAtRiskCount: number;
  missingDatesCount: number;
};

/**
 * Turns a partner's tallies into the lines shown under an activity. Counts are
 * plain tallies — no singular/plural inflection, which would be more code than
 * the clarity it buys.
 *
 * Every figure here is project-wide for the partner, not scoped to the activity
 * being read. The caller's label ("This trade's procurement:") carries that.
 */
export function describeProcurement(
  p: ActivityProcurement,
): { headline: string; details: string[] } {
  const headline =
    p.behindCount > 0
      ? `${p.behindCount} of ${p.itemCount} items behind`
      : `${p.itemCount} items, none behind`;

  const details: string[] = [];

  const lateness: string[] = [];
  if (p.submittalLateCount > 0) lateness.push(`${p.submittalLateCount} submittal late`);
  if (p.projectedLateCount > 0) lateness.push(`${p.projectedLateCount} projected late`);
  if (lateness.length > 0) details.push(lateness.join(", "));

  if (p.releasedAtRiskCount > 0) details.push(`${p.releasedAtRiskCount} released at risk`);
  // Not "behind", but not fine either: procurement cannot assess these at all.
  if (p.missingDatesCount > 0) details.push(`${p.missingDatesCount} with no required-on-site date`);

  return { headline, details };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/trades/activityTrades.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — clean.

- [ ] **Step 5: Commit**

```bash
git add lib/trades/activityTrades.ts tests/trades/activityTrades.test.ts
git commit -m "feat(trades): describe a partner's procurement tallies

Deliberately reports unassessable items even when nothing is behind — that
state currently renders identically to a trade that is genuinely fine."
```

---

### Task 2: Attach and render

**Files:**
- Modify: `components/ActivityTable.tsx` (`ActivityRow` interface lines 6-27; the `<dl>` in `renderLeafRow`)
- Modify: `app/projects/[id]/page.tsx` (the `osProcurementRisk` query at line 58; the row mapping)
- Test: `tests/components/ActivityTable.test.tsx`

**Interfaces:**
- Consumes: `ActivityProcurement` and `describeProcurement` from Task 1.
- Produces: `ActivityRow.procurement: ActivityProcurement | null`.

Page and component change together: making `procurement` required on `ActivityRow` breaks `page.tsx` until it supplies the field, so a task that split them would leave `tsc` failing in between.

**This breaks the existing test factory.** `tests/components/ActivityTable.test.tsx` has a `row()` helper building a complete `ActivityRow`; a new required field breaks it. Add the field to the factory rather than making it optional on the interface — optionality would let a caller silently omit it.

- [ ] **Step 1: Write the failing tests**

In `tests/components/ActivityTable.test.tsx`, add `procurement: null,` to the `row()` factory (after `atRisk: false,`), and add `fireEvent` to the import from `@testing-library/react` on line 3.

Then append:

```tsx
describe("ActivityTable procurement detail", () => {
  const procurement = {
    itemCount: 9,
    behindCount: 8,
    submittalLateCount: 7,
    projectedLateCount: 1,
    releasedAtRiskCount: 0,
    missingDatesCount: 0,
  };

  // The detail only exists once the row is expanded — the table renders it
  // behind a tap, so every assertion here has to open the row first.
  function openFirstRow() {
    fireEvent.click(screen.getByRole("button", { name: /Electrical Rough-In L2/ }));
  }

  it("explains the flag under the trade partner", () => {
    render(<ActivityTable rows={[row({ atRisk: true, procurement })]} />);
    openFirstRow();
    expect(screen.getByText(/This trade's procurement: 8 of 9 items behind/)).toBeTruthy();
    expect(screen.getByText("7 submittal late, 1 projected late")).toBeTruthy();
  });

  it("reports a trade that is checked and fine", () => {
    // behindCount must stay consistent with its parts: it is
    // submittalLateCount + projectedLateCount on the producing side.
    const clean = { ...procurement, behindCount: 0, submittalLateCount: 0, projectedLateCount: 0 };
    render(<ActivityTable rows={[row({ procurement: clean })]} />);
    openFirstRow();
    expect(screen.getByText(/9 items, none behind/)).toBeTruthy();
    expect(screen.queryByText(/submittal late/)).toBeNull();
  });

  it("says nothing when the partner has no cached procurement data", () => {
    render(<ActivityTable rows={[row({ atRisk: true, procurement: null })]} />);
    openFirstRow();
    expect(screen.queryByText(/This trade's procurement/)).toBeNull();
  });

  it("still describes the trade on a completed activity", () => {
    // The pill is a call to action and page.tsx suppresses it at 100%; the line
    // is reference data about the trade and is not suppressed. Only the line is
    // asserted here — the suppression rule lives in isActivityAtRisk, which has
    // its own test, and this component just renders whatever atRisk it is given.
    render(<ActivityTable rows={[row({ percentComplete: 100, atRisk: false, procurement })]} />);
    openFirstRow();
    expect(screen.getByText(/This trade's procurement: 8 of 9 items behind/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/ActivityTable.test.tsx`
Expected: FAIL — `procurement` is not a property of `ActivityRow`, and the text is not rendered.

- [ ] **Step 3: Add the field to `ActivityRow`**

In `components/ActivityTable.tsx`, after `atRisk` in the interface:

```ts
  /** Procurement tallies for this activity's trade partner, null when unknown. */
  procurement: ActivityProcurement | null;
```

Extend the import at line 4:

```ts
import { describeProcurement, type ActivityProcurement } from "@/lib/trades/activityTrades";
```

- [ ] **Step 4: Render the block**

In `renderLeafRow`, inside the `<dl>`, immediately after the trade partner line:

```tsx
            {(() => {
              if (!a.procurement) return null;
              const { headline, details } = describeProcurement(a.procurement);
              return (
                <div className="col-span-2">
                  <div>This trade&apos;s procurement: {headline}</div>
                  {details.map((d) => (
                    <div key={d} className="pl-3 text-slate-500">{d}</div>
                  ))}
                </div>
              );
            })()}
```

It spans both columns because its lines are sentences, not the short label/value pairs the two-column grid was built for. `details` entries are distinct by construction, so the string is a valid key.

- [ ] **Step 5: Widen the page query and attach the data**

In `app/projects/[id]/page.tsx`, replace the `select` on the existing `osProcurementRisk.findMany` (line 60) — still one query, serving the pill, the freshness line and now the detail:

```ts
    select: {
      osPartnerId: true,
      itemCount: true,
      behindCount: true,
      submittalLateCount: true,
      projectedLateCount: true,
      releasedAtRiskCount: true,
      missingDatesCount: true,
      fetchedAt: true,
    },
```

After `flaggedPartners`, add the lookup:

```ts
  const procurementByPartner = new Map(
    procurementRisk.map((r) => [
      r.osPartnerId,
      {
        itemCount: r.itemCount,
        behindCount: r.behindCount,
        submittalLateCount: r.submittalLateCount,
        projectedLateCount: r.projectedLateCount,
        releasedAtRiskCount: r.releasedAtRiskCount,
        missingDatesCount: r.missingDatesCount,
      },
    ]),
  );
```

In the row mapping, the partner id is already resolved for the pill. Hoist it into a local and use it for both, then add the field beside `atRisk`:

```ts
    const partnerId = trades.get(a.id)?.osPartnerId ?? null;
```

```ts
      atRisk: isActivityAtRisk(partnerId, percentComplete, flaggedPartners),
      procurement: partnerId === null ? null : procurementByPartner.get(partnerId) ?? null,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/components/ActivityTable.test.tsx`
Expected: PASS, 7 tests in the file (3 existing pill tests plus 4 new).

- [ ] **Step 7: Run the full suite and build**

Run: `npx vitest run` then `npm run build`
Expected: 312 baseline plus the new tests, all passing; build clean.

- [ ] **Step 8: Commit**

```bash
git add components/ActivityTable.tsx "app/projects/[id]/page.tsx" tests/components/ActivityTable.test.tsx
git commit -m "feat(schedule): explain the AT RISK flag in the activity detail

The pill stated a verdict it could not justify. The line renders for every
partner with cached data, not only flagged ones, so a trade whose items are all
unassessable stops reading like one that is genuinely fine."
```

---

## After the plan

Stop for review before pushing.

Verify by hand afterwards: launch from Connect into project 9 and tap an activity for Amber Electrical. Expect `This trade's procurement: 8 of 9 items behind` and `7 submittal late, 1 projected late`. Tap one for a partner with no schedule-mapped work and expect no procurement line at all.
