# Handoff — Schedule Management (Skiles Connect)

_Last updated: 2026-06-21 (Slice 5f)_

## What this is
A construction schedule tool: import MS Project XML → verify → capture weekly field
progress → export updates back to MS Project → normalize names → attribute trades.
Next.js 14 + Prisma + Postgres, deployed on Railway.

- **App (live):** https://schedulemanagement-production-bb38.up.railway.app
- **Repo:** `github.com/DHCompanion/schedulemanagement` — **`master` auto-deploys to
  Railway** (~60–90s). `gh` CLI is at `~/.local/bin/gh`, authed as `DHCompanion`.
- **Working dir:** `/home/coder/projects/Skilesconnect/schedulemanagement`

## Live in production (Slices 1, 2, 3, 5a, 5b, 5c, 5d, 5e, 5f)
1. **Import** — MS Project XML → canonical immutable snapshots + verification view.
2. **Weekly updates** — 1/3/6-week lookahead, record progress, finalize snapshots.
   Seeds progress from the base schedule's existing actuals so already-complete
   items don't flood the list.
3. **Export** — re-upload original XML, inject cumulative actuals, download updated
   file. Merge into MS Project via Import Wizard → "Merge" keyed on Unique ID
   (documented in README).
4. **5a Normalize** — global learning dictionary, raw name → standard scope (exact
   auto-map + fuzzy suggest + "Use as-is" / "Accept all as-is").
5. **5b Trades** — global scope→discipline dictionary + per-project trade-partner
   company from a deduped roster.
6. **5d Schedule health** — read-only date-sanity check over the latest import:
   out-of-envelope dates (the 2025 mis-date catch), future actuals, and missing /
   100%-contradictory dates. Pure read-time overlay; no schema change. Dedicated
   "Schedule health" page + nav button.
7. **5c Completeness (granularity check)** — flags activities mapped (via 5a) to a
   coarse canonical scope that an admin has marked should really be split into
   finer scopes (`ScopeSplitRule`, global, authored inline on the Normalize page).
   Per-project, per-`canonicalActivityKey` dismiss (`CompletenessDismissal`,
   survives re-import). Pure read-time overlay over `applyDictionary` + split
   rules; no mutation of `Activity`/`ScheduleImport`. Dedicated "Completeness"
   page + nav button. Coverage/template detection (missing scopes entirely) is
   explicitly out of scope — deferred to a future sub-slice if needed.
8. **5e Workflow integration** — sequences the pipeline as
   Import → Health → Normalize → Completeness → Trades → Weekly updates →
   Export (project nav reordered to match; no hard gate outside the wizard).
   A first-time setup wizard (`?wizard=1` banner on the Health/Normalize/
   Completeness pages) walks a project through those three steps on its first
   import only (`Project.onboardingCompletedAt`); existing projects were
   backfilled so they aren't retroactively forced through it. Health gained a
   Progress section (total/completed/remaining/%) above the 4 existing checks,
   now shown as individually-headed "clean"/issue-count sections. Normalize's
   split-rule authoring moved inline onto each unmapped-name row (instead of a
   disconnected global form) and, along with removing a rule, is now
   **admin-only** — a second `APP_ADMIN_PASSWORD` sets an elevated session
   cookie (`sms_admin`), same pattern as the existing shared `APP_PASSWORD`.
   Export now also injects each activity's canonical (normalized) name into
   the exported XML's `Task.Name`, parallel to the existing actuals injection
   — export-time only, no mutation of stored `Activity` rows.
9. **5f Completeness Accept/Split** — Completeness issues gained an **Accept**
   button (any logged-in user) alongside Dismiss. Accepting clones the latest
   `ScheduleImport` into a new **synthetic** import (`isSynthetic: true`,
   `derivedFromImportId` → parent) that replaces the coarse activity with its
   finer scopes as parallel tasks (fan-out/fan-in: predecessors/successors of
   the coarse activity are rewired onto every new task; duration/dates copied
   from the coarse activity), and records a `CompletenessSplit` row. The
   synthetic import becomes the new "latest," so every existing latest-import
   reader (dashboard, Health, Normalize, Trades, Completeness) picks it up
   automatically with no other code changes — imports themselves stay
   immutable. Export walks the `derivedFromImportId` chain
   (`resolveExportBase`) back to the nearest real ancestor to validate the
   re-uploaded file's hash, then replays every `CompletenessSplit` in the
   chain (`injectSplits`) into the exported XML before injecting actuals/
   names. Because MS Project's Unique-ID merge can add/update but never
   delete tasks, the export route returns an `X-Deleted-Tasks` header and the
   Export page shows a manual-delete checklist (also documented in
   README step 8).

Full attribution chain now in data: `name → scope → discipline → project's company`.

## How to work here (conventions)
- **Build directly on `master`** — no feature branches, no commit-permission prompts
  (prototype phase). Still gate every push on `npm run test && npm run build`.
- **TDD per task**, commit per task.
- **DB-gated tests** run only with `DATABASE_URL` set → use the Railway **public** URL
  (Railway dashboard → Postgres → Connect). They self-clean. Use a `30000`ms timeout
  for multi-round-trip tests (public-proxy latency).
- **Migrations (offline diff):** `cp prisma/schema.prisma /tmp/schema-prev.prisma`,
  edit, `prisma migrate diff --from-schema-datamodel /tmp/schema-prev.prisma
  --to-schema-datamodel prisma/schema.prisma --script`, then `prisma migrate deploy`.
- **Deploy check:** poll the new route `404→200` authed with cookie
  `sms_session=<APP_SESSION_TOKEN>`.
- **Hard rules:** no AI/LLM (CLAUDE.md "Don't Build Yet"); imports are immutable —
  normalization/attribution/progress are read-time overlays.
- Specs + plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/`.
  Tests: **128 passing, 29 files** at handoff (DB-gated suites skip without `DATABASE_URL`).

## Suggested next steps
- **5c coverage/templates** — deferred sub-slice: detect entirely-missing scopes
  per project type ("standard template" concept), as distinct from 5c's
  granularity check (coarse scope flagged for splitting), which is now live.
- Later: trade **performance/workload analytics** (consumes 5b data); Slice 4
  importers (P6 XER, Phoenix); Slice 6 reminders + lessons learned.
- **5d v2 candidates:** reversed-date check (finish < start — deselected from v1);
  per-activity acknowledge/dismiss; baseline-vs-current drift.

## Backlog
- WBS grouping in the weekly-update editor (presentation-only).
- Near-duplicate cleanup for scopes/disciplines/partners (managed taxonomy).
- Multiple subs per discipline per project; re-upload-free export (store raw XML).
- "Schedule builder" tool (preliminary schedules from history) — true future item.
- **5e follow-ups (noted, not built):** per-row qualifier preservation in
  exported names if literal canonical-scope replacement makes MS Project files
  hard to read (multiple identically-named rows); a "browse all scopes in use"
  view on Normalize if the inline-resurfaces-on-new-mapping pattern proves
  insufficient for retroactively marking long-standing scopes as coarse.

**Clean resume line for next session:** _"Plan 5c coverage/templates (deferred sub-slice), or pick up Slice 4 importers / Slice 6."_
