# Handoff — Schedule Management (Skiles Connect)

_Last updated: 2026-06-19_

## What this is
A construction schedule tool: import MS Project XML → verify → capture weekly field
progress → export updates back to MS Project → normalize names → attribute trades.
Next.js 14 + Prisma + Postgres, deployed on Railway.

- **App (live):** https://schedulemanagement-production-bb38.up.railway.app
- **Repo:** `github.com/DHCompanion/schedulemanagement` — **`master` auto-deploys to
  Railway** (~60–90s). `gh` CLI is at `~/.local/bin/gh`, authed as `DHCompanion`.
- **Working dir:** `/home/coder/projects/Skilesconnect/schedulemanagement`

## Live in production (Slices 1, 2, 3, 5a, 5b)
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
  Tests: **73 passing, 21 files** at handoff.

## Suggested next steps
- **Slice 5d — schedule-health / date-sanity** (independent, small, high-confidence;
  the 2025 mis-date catch). Easiest clean win — no dependencies.
- **Slice 5c — completeness check** (flag coarse activities to split; needs 5a + a
  "standard template" concept first).
- Later: trade **performance/workload analytics** (consumes 5b data); Slice 4
  importers (P6 XER, Phoenix); Slice 6 reminders + lessons learned.

## Backlog
- WBS grouping in the weekly-update editor (presentation-only).
- Near-duplicate cleanup for scopes/disciplines/partners (managed taxonomy).
- Multiple subs per discipline per project; re-upload-free export (store raw XML).
- "Schedule builder" tool (preliminary schedules from history) — true future item.

**Clean resume line for next session:** _"Plan and execute Slice 5d (schedule-health check)."_
