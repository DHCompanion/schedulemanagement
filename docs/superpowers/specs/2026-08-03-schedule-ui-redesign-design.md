# Schedule Manager UI Redesign — Design

**Date:** 2026-08-03
**Status:** Approved design, pending implementation planning

## Problem

The project page treats six actions (Task Naming, Task Granularity, Trades,
Progress Update, Export, Import) as equal-weight buttons in a row, but the tool
really contains two workflows with different rhythms, users, and devices:

1. **Data hygiene** — task naming, granularity, trade assignment. A burst of
   desk work by a scheduler/PM right after each import, quiet otherwise.
2. **Update & track** — weekly progress capture, procurement/at-risk awareness,
   export. The recurring rhythm; progress capture happens in the field on a
   phone.

The schedule body (indented WBS outline with dates right-aligned) reads
awkwardly, lookahead windows exist only inside the update form, and there is no
meeting-ready output — export means MS Project XML only.

Direction confirmed with the owner: the tool becomes the **primary tracking
surface**. Import recedes to major revisions; export becomes record-keeping;
seeing **schedule drift** in-tool is the priority.

## Decisions (settled during brainstorming)

- Hygiene is a post-import burst → framed as a receding queue, not a co-equal
  daily workspace.
- Devices split: hygiene assumes desktop; tracking must be genuinely
  mobile-first.
- A **forecast/drift layer is designed and built** as part of this work (it does
  not exist today — relationships are imported but only used at export).
- Schedule body: **timeline rows (mini-Gantt) on desktop**, **time-bucketed work
  cards on mobile**. WBS section color palette is **retained** for identity.
- Shell: **two tabs** (Schedule / Data Health) with a **command-center stat
  strip** above the timeline.
- Meeting PDF: **summary page + trade-banded bar grid** (both, in one export).
  **11×17 (tabloid) landscape is the standard page size; letter is the
  fallback.**
- The week-bucket derivation feeds the **OS context packet** so Connect can
  render the same data in its project week view.

## 1. Forecast/drift engine (`lib/forecast/`)

Pure function, no schema changes, no stored state.

**Input:** latest import's activities + relationships; current progress from
latest finalized update entries (same source as `resolveCurrentProgress`).

**Output per activity:** `expectedStart`, `expectedFinish`, `driftDays`
(expected finish minus planned finish, in working days), `pushedBy` (the
predecessor that pushed it, for "pushed by X" UI copy).

**Rules:**

- **Completed** → expected dates are actuals; drift frozen history.
- **In progress** → expected finish = status date + remaining duration, where
  remaining = planned duration × (1 − %complete), in working days.
- **Not started** → expected start = latest of planned start and each
  predecessor's expected finish + lag (FS; SS ties starts). Expected finish
  follows by planned duration.
- **Never earlier than planned** (v1): early finishes do not pull successors in.
  The layer shows slip, not opportunity.
- **No float math, no leveling, no calendars** beyond working days (weekends
  skipped via the import's minutes-per-day; holidays ignored in v1). MS Project
  remains the authority for real rescheduling.
- **Project-level drift** = drift of the latest-finishing incomplete activity.
- **Out-of-sequence work:** an activity with an actual start is never pushed;
  the forward pass skips that edge. Reality wins.

**Execution:** server-side at page load through one shared function so the
body, buckets, stat strip, OS packet, and PDF read identical numbers. Forward
pass is O(activities + relationships); cache per (import, latest update) only
if it proves slow.

**Testing:** fixture chains with exact expected dates asserted — FS lag push,
SS, partial progress, out-of-sequence, completed-early.

## 2. Shell — two tabs + stat strip

The six flat buttons are removed. Persistent header (project + client left,
person + Back to Connect right) is unchanged.

**Tab 1 — Schedule (default):**

- **Stat strip:** projected drift (red when positive) · at-risk count ·
  % complete · last update ("Updated Jul 27 · 6 days ago", amber when >7 days).
  Each stat links: drift → body sorted by drift; at-risk → filtered to flagged;
  last update → updates history.
- **View switcher:** `Full · 6 wk · 3 wk` — time windows over the same body,
  not separate pages.
- **Actions:** primary **Update progress** (straight into a new/draft update;
  the updates list becomes history reachable from the last-update stat).
  Secondary **Export ▾** menu: Lookahead PDF (3 wk / 6 wk) and MS Project XML.

**Tab 2 — Data Health:**

- Naming, granularity, and trades merged into **one triaged queue**,
  newest-import first, one-click accept/dismiss in place (re-skin of existing
  endpoints, not new mechanics). Collapsible sections: Unnamed tasks,
  Granularity flags, Unassigned trades, each with counts.
- **Tab badge** = total open items; loud after an import, gone when clean.
- **Import schedule** and the import metadata card live here. The per-import
  wizard/onboarding banner logic folds into this tab. Admin-only reset stays at
  the bottom.

**Mobile:** same tabs; Schedule renders the bucket view (Section 3) instead of
the timeline; Data Health is functional-but-basic.

**Routes:** `/projects/[id]` (Schedule), `/projects/[id]/data` (Data Health).
Old routes (`/normalize`, `/completeness`, `/trades`, `/updates`, `/export`,
`/import`) redirect into the tabs.

## 3. Schedule body

One set of server-computed rows (activities + forecast + trades + procurement),
two renderings by screen width, shared filters (search; milestones / critical /
in-progress / not-completed; trade).

**Desktop — timeline rows:**

- Left column (~38%): collapsible WBS section headers **keeping the existing
  six-color palette** (top-level full-strength, nested lighter). Activity rows:
  canonical name first with MS Project wording muted beneath, trade chip,
  AT RISK pill, milestone diamond.
- Each activity row carries a thin **left rail in its section's color** so
  section identity survives long scrolls and narrow time windows. Color
  channels do not collide: row edge = where you are; bars = how it's going.
- Right: shared time axis — week gridlines, shaded weekends, today line. Thin
  grey **planned** bar, solid teal **expected** bar beneath, completed portion
  darker, red drift label (`+3d`) at bar-end only when nonzero. Milestones:
  grey planned diamond, solid expected diamond.
- View switcher sets the axis domain: Full fits the project; 6 wk / 3 wk window
  from today with day-level spacing.
- Row click → detail panel (existing fields: ID, float, duration, %, trade,
  procurement tallies + AT RISK explanation, custom fields) plus planned vs
  expected dates and "pushed by <predecessor> (+Nd)".
- Sorts (WBS / start / float) survive; non-WBS sorts use the flat ungrouped
  mode as today; start-sort orders by expected start.

**Mobile — week buckets:**

- Buckets: This week / Next week / Weeks 3–6 / Later / Done (Done collapsed).
  Bucketing uses **expected** dates.
- Cards: name, trade + partner, status edge-color (red drifting / amber pushed
  / green on plan) with the section-colored accent behind it, drift in words
  ("was Aug 7 → now Aug 12"), % complete, AT RISK pill. Tap → same detail
  panel (names the WBS section).
- Bucket derivation is a pure lib function; the **OS context packet**
  (`scheduleContextPacket`) exposes the same buckets.

**Progress capture:** the update flow keeps its mechanics (status, actuals, %)
restyled as the bucket cards — field users update the cards they browse.

## 4. Lookahead views + meeting PDF

**One route serves screen and paper:** `/projects/[id]/lookahead?weeks=3|6`
renders the C design; on screen it is the lookahead view, printed it is the
PDF.

**Page 1 — Summary:**

- Branded header: SKILES GROUP · project, window ("3-Week Lookahead ·
  Aug 3–23, 2026"), status date, generated date.
- Stat strip (drift, at-risk, % complete, starting-this-window count).
- **Attention box** in generated sentences: procurement flags ("TDIndustries
  behind on 3 items — Overhead MEP at risk"), drift causes from `pushedBy`
  ("In-Wall Rough-In pushed +3d by MEP slip"), stale-update warning.
- **Milestone strip:** window milestones plus the next 2–3 beyond, planned vs
  expected diamonds on one line.

**Pages 2+ — Trade-banded bar grid:**

- Weeks as columns with day ticks, weekends compressed. Color-banded trade
  headers with partner names; band color is a stable hash of the trade (same
  trade = same color across projects and weeks). Untraded activities land in a
  final "Unassigned" band.
- Rows: name, red drift delta when nonzero, bar spanning expected working days
  with a grey ghost tick at planned finish when it differs, % complete fill,
  milestone diamonds on the axis.
- Paginates by trade band (a band never splits mid-trade unless it alone
  exceeds a page). Footer: "Exported from Schedule Manager · page n/N".

**Page size:** **11×17 (tabloid) landscape is the standard**; **letter
landscape is the fallback** (user-selectable at export; print CSS defines both
via `@page` size options).

**Generation:** print CSS ships first (browser Print → Save as PDF works
immediately). Then the Export menu's Lookahead PDF button hits
`/api/export/lookahead-pdf?weeks=3&size=tabloid|letter`, rendering the same
route headless (`playwright-core` + `@sparticuz/chromium`, within Vercel
function limits) and streaming
`<project>-3wk-lookahead-<date>.pdf`. If serverless Chromium fails us, the
print-CSS route is the fallback and nothing else changes.

**Scope guard:** PDF is view-only output; no stored export history in v1 — the
dated filename is the record.

## Build phases

Each phase ships usable on its own; each gets its own implementation plan.

1. **Forecast engine** — `lib/forecast/` + tests. No UI.
2. **Shell** — tabs, stat strip, Data Health queue consolidation, route
   redirects.
3. **Schedule body** — desktop timeline, mobile buckets, Full/6wk/3wk views,
   OS context packet buckets.
4. **Lookahead PDF** — print-styled route (screen + print CSS, 11×17 standard /
   letter fallback), then the headless-Chromium download endpoint.

## Out of scope (v1)

- Full CPM: float recalculation, leveling, calendars/holidays, pulling
  successors earlier on early finishes.
- Editing planned dates, durations, or logic in-tool (MS Project owns
  rescheduling).
- Stored PDF export history.
- Authentication changes, new integrations, drag-and-drop (per
  `docs/CURRENT_STATE.md` boundary in the parent project).

## Existing behavior preserved

- Import wizard mechanics, XML export round-trip (hash-matched re-upload,
  Unique-ID merge), update finalize/immutability, accept/dismiss endpoints for
  naming/granularity/trades, AT RISK pill semantics and procurement detail
  lines, admin reset.
- Old URLs redirect rather than 404.
