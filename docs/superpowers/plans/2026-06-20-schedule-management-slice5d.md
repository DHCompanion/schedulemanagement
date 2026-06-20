# Slice 5d Implementation Plan — Schedule-Health / Date-Sanity

**Spec:** `docs/superpowers/specs/2026-06-20-schedule-management-slice5d-design.md`
**Approach:** pure check lib → thin DB service → server page → client table → nav button.
No schema change, no migration, no API route. TDD per task; commit per task.

## Task 1 — Design spec + this plan
Write spec + plan docs matching prior slices. Commit.

## Task 2 — `lib/health/dateChecks.ts` (pure, TDD)
Write `tests/health/dateChecks.test.ts` first (red), then implement:
- Types: `HealthSeverity`, `HealthCheck`, `HealthActivity`, `HealthIssue`, `DateWindow`.
- `computeEnvelope(activities, importEnvelope)` — stored envelope (+180d buffer) or
  outlier-robust derived window (sort planned dates, trim ~5% tails, min/max + buffer);
  `null` when neither available (< ~8 dated activities and no stored envelope).
- `checkOutOfEnvelope`, `checkFutureActuals`, `checkMissingDates`,
  `checkPercentContradictions` — each `HealthIssue[]` for one activity.
- `runHealthChecks(activities, importEnvelope, asOfDate)` — filter to leaf+active, compute
  window, run checks, sort by severity then `wbsCode`.
- `summarizeHealth(issues)` — `{ errors, warnings, byCheck }`.
Test cases: 2025 mis-date flagged while neighbours pass; derived envelope robust to one
outlier; future actual only past `asOfDate`; missing-date + contradiction edges; empty →
none; too-few-dates → no envelope check. Commit.

## Task 3 — `lib/health/healthService.ts` + DB test
`getScheduleHealth(projectId)` loads latest import + activities (normalize-page pattern),
maps to `HealthActivity`, returns `{ hasImport, asOfDate, window, issues, summary }`.
`asOfDate = statusDate ?? importedAt ?? new Date()`. DB-gated integration test
(`tests/health/healthService.test.ts`, 30000ms, self-cleaning). Commit.

## Task 4 — Page + table + nav
- `app/projects/[id]/health/page.tsx` (server, `force-dynamic`): back-link, summary line
  (X errors · Y warnings or "No date issues found"), data-date note, `HealthIssuesTable`;
  empty-import guard.
- `components/HealthIssuesTable.tsx` (client): search + severity/check filter, severity
  badges, read-only list (ActivityTable styling).
- `app/projects/[id]/page.tsx`: add "Schedule health" nav link. Commit.

## Task 5 — Verify, push, handoff
`npm run test && npm run build`; push to master; poll `/projects/<id>/health` 404→200 with
`sms_session` cookie; update `docs/SLICE5_HANDOFF.md` (5d live, test count, resume line).
