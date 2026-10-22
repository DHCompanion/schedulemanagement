# Historical Schedule Backfill & Generated Baselines — Spec

Date: 2026-10-22 · Status: agreed (grilling session)

## Goal

Backfill Schedule Manager with ~200 historical projects (task naming, coarse→fine breakdowns, durations, logic) and make the tool capture and leverage that information **by default** on every import, so no standing pipeline is needed. End state: a PM/Super can ask "Cath Lab coming up — give me a rough baseline" for planning or bidding.

## Principles

- **No separate pipeline.** Every pass is a permanent part of the normal import path (`lib/import/commitImport.ts`). The backfill is a throwaway script that loops a folder through `commitImport`, then is deleted.
- **Feedback loop is structural.** Passes run on every import; benchmarks are a live query. New baselines/updates improve everything automatically.
- **Reuse before adding.** Existing scope dictionary, trade dictionary, and `ScopeSplitRule`s are matched first; no duplicate breakdowns.

## Import passes (run on every import)

1. **Logic quality score** (DCMA 14-point style): missing logic, open ends, hard constraints, leads, excessive lags, high/negative float, high duration, out-of-sequence progress. Stored per import. Gates benchmark eligibility.
2. **File tier** (auto, admin-overridable):
   | Tier | Signal | Feeds |
   |---|---|---|
   | As-built / updated | status date + actuals + progress | durations, slip, sequencing, naming |
   | Baseline only | logic, no actuals | planned durations, sequencing, naming |
   | Rough | sparse logic, constraint/summary-driven, low score | naming + coarse→fine breakdowns only |
   | Junk | parse fail / < N activities | nothing (logged) |
3. **Dictionary suggestions**: unmapped names → suggested canonical scope (existing Jaccard + LLM classifier) → admin review queue sorted by frequency.
4. **Split-rule mining**: WBS parent/child patterns → match existing `ScopeSplitRule`s first; only novel patterns become proposals in the same review queue.
5. **Sub identity**: raw subcontractor text (names, resources, custom fields, WBS) + suggested trade-partner match, when present. Scoring deferred.
6. **Per-project extraction**:
   - duration per canonical scope (planned + actual), working days on the activity's calendar
   - slip (actual − baseline) per scope, as-built tier only
   - sequencing pairs: scope A → scope B frequency, relationship type, lag
   - criticality frequency per scope
   - key milestones (NTP, rough-in, inspections, substantial completion, TCO) and gaps
   - phasing / area structure from WBS + custom fields

## Storage & intake

- Keep raw source files in a **private S3 bucket**, access via signed URLs (re-extraction later needs originals; today only `fileHash` is kept).
- `.mpp`: pilot files saved to XML manually in MS Project. Add an MPXJ converter when volume justifies it or Primavera XER appears.
- **Admin bulk table**: confirm project grouping (exact dupes by `fileHash`, then project name + date overlap) and fill project metadata (sector, buildingType, sizeSqFt, contractValue, region, deliveryMethod), prefilled from filename/project props/LLM guess.

## Benchmarks

- Live SQL query/view, no stored table.
- Per project per canonical scope: **span** (earliest start → latest finish of all mapped activities).
- Report median + P25–P75. Show only when **n ≥ 5 projects**. Segment by buildingType, fall back to sector.
- Exclude `isSynthetic` imports (generated drafts never feed their own stats).
- In-progress projects: a scope's actuals count once that scope has an actual finish; otherwise planned only (from baseline).
- Only tiers passing the logic gate contribute durations.

## Surfacing (PMs / Supers)

- Historical range shown beside activity duration on edit/import.
- New Data Health check: **duration outside historical range**.
- "Usually critical" indicator per activity.

## Draft baseline generator

- **Inputs:** building type, size (SF), start date, scope checklist (scopes seen in that building type; can add).
- **Assembly from statistics:**
  - one activity per canonical scope; include split-rule children only where most historical projects split that way (finer detail handled later by the existing breakout workflow)
  - link A → B when it appears in **≥ 50%** of projects containing both; modal relationship type, median lag
  - repair: break cycles by dropping the weakest link; tie open starts/ends to start/finish milestones
- **Durations: always P75** (err long). Scopes with < 5 projects flagged low-confidence.
- **Thresholds:** hard error if < 5 qualifying (baseline/as-built, logic-gated) projects of that building type; warnings on thin activities and links; confidence summary at top.
- **Output:** new Schedule Manager project, `isSynthetic` with lineage, exportable to MSP XML via existing `lib/export`.

## Out of scope

- Procurement lead times (historical data stale; procurement tool owns lead times).
- Sub/trade partner performance scoring (later; feeds the trade partner directory).
- Resource loading, cost, progress S-curves.

## Build order

1. Logic score + file tiering
2. Raw file S3 storage + `.mpp` save-as process
3. Pilot backfill: 9 cath lab files in `Schedulecomparisions/` — validate tiering, suggestions, split matches, benchmarks (expect thin benchmarks)
4. Review queues (dictionary, split rules) + admin metadata/grouping table
5. Benchmark view + surfacing (range, Data Health check, criticality)
6. Full ~200-file backfill
7. Draft baseline generator
