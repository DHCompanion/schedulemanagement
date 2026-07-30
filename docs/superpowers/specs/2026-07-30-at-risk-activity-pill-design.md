# AT RISK pill on schedule activities, from procurement

Date: 2026-07-30
Status: approved, not yet implemented

A proof of concept for the second direction of the Procurement ↔ Schedule Manager
cross-tool context: an `AT RISK` pill on a schedule activity whose trade partner
has a procurement problem.

This is the first consumer of `procurement_project_summary` on this side. It
reads one field of the packet. The rest of the packet is cached but not yet
displayed — what to do with it is a separate design.

## Problem

Procurement knows which trade partners have material that is ordered at risk or
carrying an open variance. The schedule shows when those partners are working.
Neither view answers the question a superintendent actually asks: *is anything I
am about to start exposed?*

Context flows through the OS — neither tool calls the other. Procurement's half
is built — `procurementContextPacket.ts` and its `/api/os-context` route are
committed and deployed — but **not yet serving**. Nothing on this side consumes
it yet.

### Known blocker: procurement's secret is misspelled

Probed 2026-07-30 with a signed request against
`https://sgconnect.dev/procurement-manager/api/os-context`:

```
500  {"error":"PROCUREMENT_MANAGER_CONTEXT_SECRET is not set"}
```

The route is deployed and reachable; that 500 is its fail-closed-on-
misconfiguration path behaving correctly. The variable is spelled
`PROCUREMENT_MANAGER_CONTECT_SECRET` — **CONTECT** — in the `.env` and
`.env.local` of both repos, while both repos' `verifyCallback.ts` read
`..._CONTEXT_SECRET`. The correctly-spelled name is absent everywhere, and the
500 says the same typo reached procurement's Vercel environment.

The same probe against this tool's own callback returns
`401 Invalid callback signature`, which confirms `SCHEDULE_MANAGER_CONTEXT_SECRET`
*is* set here and that Direction A is genuinely live.

**Consequence for this work:** every step below can be built and unit-tested
against a fixture, but end-to-end verification is blocked until procurement sets
the correctly-spelled variable on their service. Until then a real launch caches
zero rows — which this design already renders as "unknown" rather than "nothing
at risk", so the blocker degrades safely.

## What the pill means

**Procurement flagged this partner.** Specifically, `atRiskCount > 0` on that
partner's packet row, which procurement computes as
`item.orderedAtRisk || openVariances > 0`.

This is deliberately procurement's judgment surfaced, not a second opinion
invented here. The alternative considered — comparing the partner's
`earliestRequiredOnSite` against the activity's `plannedStart` — was rejected for
this slice because the packet carries **one date per partner**, so every activity
under a partner would compare against the same earliest material date. For a
partner whose work spans months that is noise, not signal. Procurement's own spec
records the same limitation from the other direction and defers it to a
per-activity exposure they would need from us.

## Data flow

```
/launch  ──token──▶  OS POST /tool-gateway/context-requests
                     { target: "procurement-manager",
                       packetType: "procurement_project_summary", limit: 25 }
             ◀──────  { items[], summary, warnings }   one item per partner
                          │
                     OsProcurementRisk         cached per project × partner
                          │
project page ────────────▶ Set<osPartnerId> where atRiskCount > 0
                          │
                     ActivityRow.atRisk ──────▶ [AT RISK] pill
```

### Why cache at launch rather than fetch live

`/launch` exchanges the gateway token for project context and then discards it —
only a signed scope cookie survives. At the moment someone views the project
page there is no credential to call the OS with.

Two mechanisms were on the table:

- **Procurement's**: stash the token in an httpOnly cookie (`procurement_gw_token`,
  `src/lib/os/cookie.ts`) and fetch live on each render.
- **This repo's**: fetch at launch, cache the answer, drop the token — which
  `cacheTradePartners()` already does for the OS trade partner roster.

Both are proven, in their own repos. The deciding factor is not the plumbing but
the pill: **the gateway token lives 15 minutes**
(`toolGatewayToken.ts`, `defaultSessionTtlMs`). Under the live-fetch mechanism,
every pill on the page silently disappears a quarter hour into a session. A
panel can render "relaunch to see this"; a pill cannot. An absent pill reads as
"this activity is fine" — a false negative that looks like a fact.

So: cache at launch. Data is as fresh as the last launch from Connect, which is
stated on the page rather than implied.

## Components

### 1. Gateway client — `lib/os-gateway.ts`

Add beside the existing `getTradePartners`, using the same `call()` helper:

```ts
export type OsProcurementRiskItem = {
  osPartnerId: number;
  partnerName: string;
  itemCount: number;
  earliestRequiredOnSite: string | null;
  leastAdvancedState: string;
  openVarianceCount: number;
  atRiskCount: number;
};

export type OsProcurementSummary = {
  packetType: string;
  projectId: number;
  items: OsProcurementRiskItem[];
  summary: Record<string, unknown>;
  warnings: string[];
};

export async function getProcurementSummary(token: string): Promise<OsProcurementSummary>;
```

`POST /context-requests` with
`{ target: "procurement-manager", packetType: "procurement_project_summary", limit: 25 }`.
The OS derives project and person from the token — none of those go in the body.
`items: []` with a warning is a normal answer, returned as-is.

No new file. `call()` already takes a `RequestInit`.

### 2. Cache table — `prisma/schema.prisma`

Mirrors `OsTradePartner`, the existing model for OS-sourced cached data:

```prisma
model OsProcurementRisk {
  id                     String    @id @default(cuid())
  projectId              String
  project                Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  osPartnerId            Int
  partnerName            String
  itemCount              Int
  atRiskCount            Int
  openVarianceCount      Int
  earliestRequiredOnSite DateTime?
  leastAdvancedState     String
  fetchedAt              DateTime  @default(now())

  @@unique([projectId, osPartnerId])
}
```

Every partner row is stored, not only the flagged ones. Two reasons: the
"checked, nothing flagged" state below depends on rows existing for an
unflagged project, and the remaining fields are the subject of the next design —
a second migration to widen this table would be the sillier outcome.

`Project` gains the `osProcurementRisks` back-relation.

*Postgres note:* nothing SQLite-specific here; this repo is already on Postgres.

### 3. Launch — `app/launch/route.ts`

One call next to the existing roster refresh:

```ts
await cacheTradePartners(token, project.id);
await cacheProcurementRisk(token, project.id);
```

`cacheProcurementRisk` follows `cacheTradePartners` exactly: delete-then-insert
inside one transaction, wrapped in a `try/catch` that swallows and keeps whatever
was cached before. **A dead or unreachable procurement service must never block
entry to the schedule tool.** The next launch retries.

An empty `items[]` writes zero rows, which correctly clears any stale cache.

### 4. The join — `lib/trades/activityTrades.ts`

`ActivityTrade` gains one field:

```ts
export type ActivityTrade = {
  disciplineName: string;
  partnerName: string | null;
  osPartnerId: number | null;
};
```

Read from the `ProjectAssignment` that `resolveActivityTradesWith` already holds:
`assignments.get(discipline.id)?.osPartnerId ?? null`. Purely additive — the
existing name fields and every current caller are untouched.

This completes the chain end to end:

```
activity.name -> canonicalScope -> OS discipline -> ProjectTradeAssignment.osPartnerId
              -> OsProcurementRisk.osPartnerId    -> atRiskCount
```

Joined on `osPartnerId`, never on `partnerName` — the name is a display snapshot
and will not survive a partner rename.

### 5. The rule — `app/projects/[id]/page.tsx`

Computed server-side, where `percentComplete` is already resolved, so
`ActivityTable` receives a plain boolean and stays a dumb renderer:

```ts
const flagged = new Set(
  (await prisma.osProcurementRisk.findMany({
    where: { projectId: project.id, atRiskCount: { gt: 0 } },
    select: { osPartnerId: true },
  })).map((r) => r.osPartnerId),
);

// per row:
atRisk: partnerId !== null && flagged.has(partnerId) && percentComplete !== 100
```

`ActivityRow` gains `atRisk: boolean`.

**Completed activities are suppressed.** Work that is done cannot be threatened
by late material, and a completed row wearing `AT RISK` invites the same question
every time someone reads the schedule.

### 6. The pill — `components/ActivityTable.tsx`

In `renderLeafRow`, beside the existing `✓ Completed` pill and styled to match:

```tsx
{a.atRisk && (
  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
    AT RISK
  </span>
)}
```

Amber, not red: red already means *critical path* on that same line
(`text-red-700` on the activity name). Two reds meaning two different things on
one row is how a schedule gets misread at 6am.

Leaf rows only — no roll-up onto WBS section headers. A section header saying
`AT RISK` cannot say which of its children is affected, and collapsing to find
out defeats the point.

### 7. The freshness line — `app/projects/[id]/page.tsx`

Under the existing import-detail block:

```
Procurement risk as of 2026-07-30 09:14
```

Rendered **only when cached rows exist**. This distinction is the whole reason
step 2 stores unflagged partners too, and it needs no extra code:

| State | Rows | Page shows | Reads as |
|---|---|---|---|
| Never launched from Connect, or procurement unreachable | none | no pills, no line | unknown |
| No procurement project linked, or no items | none (empty packet) | no pills, no line | unknown |
| Procurement has data, nothing flagged | some | no pills, line present | checked, nothing flagged |
| Procurement has data, partners flagged | some | pills, line present | act on these |

The page never claims "nothing is at risk" on the strength of an answer it does
not have.

## Error handling

- **Launch fetch fails** (procurement down, OS 503, network) — swallowed, prior
  cache kept, launch completes. Same contract as `cacheTradePartners`.
- **Empty packet** (`items: []` plus a warning) — a normal answer. Zero rows
  written, no line rendered.
- **Partner flagged but no activity maps to them** — nothing renders. Expected:
  the activity-to-trade chain is incomplete on a fresh project by design.
- **Activity has no mapped scope or no assigned partner** — `osPartnerId` is
  `null`, no pill. Blank is correct here, as it already is for the discipline and
  trade partner lines in the row detail.

## Tests

- **The rule** (pure): flagged partner → pill; flagged partner at 100% → no
  pill; unmapped partner → no pill; unflagged partner → no pill.
- **`ActivityTable`** render test, alongside the seven existing component tests:
  a row with `atRisk` shows the pill, one without does not.
- **`tests/launch.test.ts`**: a failing procurement fetch still completes the
  launch and leaves the redirect and cookies intact.
- **`getProcurementSummary`** URL and body construction, matching the existing
  gateway client test (`b56ef77`).

## Out of scope for this slice

Named so they are not mistaken for oversights:

- Procurement's `warnings` (unassigned items, undated items, truncation) are
  fetched and discarded. They explain *why* a partner may be missing, and belong
  in whatever panel displays the rest of the packet.
- No `At risk` option in the activity filter dropdown.
- No per-activity date comparison against `earliestRequiredOnSite` — needs
  per-activity grain from procurement, or a defensible rule at partner grain.
- Nothing refreshes mid-session. Relaunching from Connect is the refresh.
- `leastAdvancedState`, `openVarianceCount`, `itemCount` and
  `earliestRequiredOnSite` are cached and unused until the follow-up design.

## Telemetry

No change. This tool's manifest carries an explicit telemetry opt-out, and the
OS telemetry endpoint is a retired stub returning 503. This slice adds no
emission and no manifest change — the packet type and the dependency on
`procurement-manager` are already declared in the OS registry.

## References

- `docs/PROCUREMENT_CROSS_TOOL_HANDOFF.md` — both directions, written from this side
- `Procurement/src/lib/os/procurementContextPacket.ts` — the packet we consume
- `Procurement/docs/superpowers/specs/2026-07-29-procurement-schedule-cross-tool-context-design.md`
  — the mirror-image design
- `backend/src/core/moduleRegistry/moduleRegistry.ts` — both manifests
