# Explaining why an activity is AT RISK

Date: 2026-07-31
Builds on: `docs/superpowers/specs/2026-07-30-at-risk-activity-pill-design.md`
Cross-repo context: `Skilesconnect/Procurement/docs/superpowers/specs/2026-07-31-item-status-vocabulary-design.md`

## Problem

The `AT RISK` pill states a verdict it cannot justify. A superintendent sees the
flag and has no way to learn what is actually wrong without leaving the schedule
tool and opening procurement.

Worse, the pill's silence is ambiguous in a way that matters. A partner whose
every procurement item lacks the dates to assess produces `behindCount = 0`, so
no pill renders — indistinguishable from a trade that is genuinely on track. On
project 9 that is four partners and eleven items today. This is the same
false-negative class the cache-at-launch decision and the `shouldShowProcurementRiskLine`
gate were introduced to prevent; it survives in the one place nothing has covered.

## The decision

Show the procurement breakdown in the activity row's existing expanded detail,
for every partner with cached data — not only flagged ones.

**No schema change, no migration, no gateway change.** Every field needed is
already cached in `OsProcurementRisk` and currently unread: `itemCount`,
`behindCount`, `submittalLateCount`, `projectedLateCount`, `releasedAtRiskCount`,
`missingDatesCount`. This is a display change over data already on hand.

### Why the expanded detail, and not a tooltip or a panel

- **Not a tooltip.** This tool is mobile-first. There is no hover on a phone, and
  the field is exactly where the answer matters.
- **Not a separate panel.** A panel is not tied to the activity being read: you
  see a pill, then hunt for the partner in a list. The detail panel already opens
  on tap and already shows discipline and trade partner — the reason belongs
  beside the cause.

## The conceptual split

**The pill describes this activity. The line describes the trade.** Same data,
different questions, and this is why they behave differently:

- The pill is a call to action, so it is suppressed at 100% complete — finished
  work cannot be threatened by late material.
- The line is reference data about the trade, so it renders regardless of this
  activity's progress. Tapping a completed activity still tells you that trade has
  problems elsewhere.

This is also why the label reads **"This trade's procurement:"** and not
"Procurement:". Every number on the line is project-wide for that partner, not
scoped to the activity tapped. The label has to carry that, or the counts read as
belonging to the row.

### Deliberately omitted: `earliestRequiredOnSite`

The cached earliest-required-on-site date is **not** shown, though it is on hand.
It is the earliest across all of that partner's items project-wide. Displaying it
beside an activity's start date invites the reader to compare the two, and that
comparison is invalid at this grain — a trade whose work spans months would read
as wrongly fine or wrongly late. Omitting it keeps every number on the line true
at the grain it is stated. This is the same reasoning that rejected date
comparison as the pill's trigger in the original design.

## The four states

| Cached row for the partner | Line rendered |
|---|---|
| none | nothing — same "unknown" semantics as the freshness line |
| behind | `8 of 9 items behind` plus breakdown |
| not behind, all assessable | `9 items, none behind` |
| not behind, some unassessable | `6 items, none behind` plus `6 with no required-on-site date` |

The last row is what earns this feature. It is the state that currently renders
identically to "everything is fine".

## Components

### 1. The describer — `lib/trades/activityTrades.ts`

A pure function beside the existing `isActivityAtRisk` and
`shouldShowProcurementRiskLine`, which already own this page's procurement-display
decisions:

```ts
export type ActivityProcurement = {
  itemCount: number;
  behindCount: number;
  submittalLateCount: number;
  projectedLateCount: number;
  releasedAtRiskCount: number;
  missingDatesCount: number;
};

export function describeProcurement(
  p: ActivityProcurement,
): { headline: string; details: string[] };
```

- `headline` — `"${behindCount} of ${itemCount} items behind"` when `behindCount > 0`,
  otherwise `"${itemCount} items, none behind"`.
- `details` — zero or more lines, in this order, each omitted when its count is 0:
  - the two lateness kinds joined into one line:
    `"7 submittal late, 1 projected late"`, or just one when the other is 0
  - `"1 released at risk"`
  - `"6 with no required-on-site date"`

Singular/plural is not handled — the counts read as tallies (`1 submittal late`),
and inflection logic would be more code than the clarity it buys.

*Placement note:* this file now holds three procurement-display helpers alongside
the activity-trade resolution it is named for. That is acceptable at three; if a
fourth arrives, split them into `lib/procurement/display.ts` rather than letting
the file drift further from its name.

### 2. The query — `app/projects/[id]/page.tsx`

The existing `osProcurementRisk.findMany` widens its `select` from three columns
to the full count set, and builds a `Map<number, ActivityProcurement>` keyed by
`osPartnerId`. Still **one query** — it already serves the pill and the freshness
line, and this adds no round trip.

Each row gets `procurement: byPartner.get(osPartnerId) ?? null`, resolved through
the same `trades.get(a.id)?.osPartnerId` the pill already uses. An activity with
no resolvable partner, or a partner with no cached row, gets `null`.

### 3. The rendering — `components/ActivityTable.tsx`

`ActivityRow` gains `procurement: ActivityProcurement | null`. Inside the existing
`<dl>`, below the trade partner line:

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

The block spans both columns of the existing two-column grid because its lines are
sentences, not the short label/value pairs the grid was built for. `details` is
keyed by its own string — the lines are distinct by construction, so no index key
is needed.

## Error handling

- **No cached rows at all** (never launched, procurement unreachable) — every row
  gets `null`, no lines anywhere. Consistent with the freshness line, which is
  also absent in that state.
- **Partner cached but activity unmapped** — `osPartnerId` is `null`, so
  `procurement` is `null`. Blank is correct, as it already is for the discipline
  and trade partner lines.
- **Counts that do not reconcile** (e.g. `behindCount` exceeding `itemCount`) are
  not defended against. They would mean a procurement-side bug, and inventing a
  display rule here would hide it rather than surface it.

## Tests

- **`describeProcurement`** (pure) — both lateness kinds together; one alone;
  none behind; none behind with missing dates; released at risk; a partner with
  zero items.
- **`ActivityTable`** — a row carrying procurement data renders the headline and
  its detail lines; a row with `procurement: null` renders neither. Add to the
  existing `tests/components/ActivityTable.test.tsx`.

## Out of scope

- `earliestRequiredOnSite`, for the reason given above.
- Per-activity precision — naming *which* item is late, rather than counts for the
  trade. That needs a different packet on both sides and is a full feature build,
  not a display change.
- Any link or deep-link into the procurement tool.
- Surfacing procurement's `warnings`, still fetched and discarded.
- A summary panel of flagged partners.
