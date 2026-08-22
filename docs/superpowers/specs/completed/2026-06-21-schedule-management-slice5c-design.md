# Schedule Management Tool — Slice 5c Design Spec (Completeness / Granularity Check)

**Date:** 2026-06-21
**Status:** Design approved; ready for implementation planning
**Owner:** Skiles Group (AJ Woodyard)
**Location:** `/home/coder/projects/Skilesconnect/schedulemanagement`
**Builds on:** Slice 1 (import + canonical model), Slice 5a (scope dictionary + normalization).

---

## 1. Context

The Slice 1 roadmap named Slice 5's "completeness check" in one sentence: flag
coarse activities that should be split into properly tracked scopes (e.g. a
single "MEP Rough" that should be electrical rough / plumbing rough /
mechanical rough), "driven by project-type-adjusted templates." The 5a spec
listed 5c as depending on 5a; the handoff doc deferred it, noting it "needs 5a
+ a 'standard template' concept" that was never designed.

On review, "completeness" in the original framing actually has two distinct
senses that were never separated:

1. **Granularity** — a tracked activity exists, but it's too coarse (should be
   N activities, is tracked as 1).
2. **Coverage** — an expected scope is missing from the schedule entirely
   (the project-type-template angle).

This spec scopes **5c to granularity only**. Coverage/templates is explicitly
deferred to a later sub-slice, once there's more cross-project scope data to
know what a template should even contain.

**Deterministic, no AI**, per `CLAUDE.md` "Don't Build Yet" — same constraint
as 5a/5b/5d.

---

## 2. Slice Goal

Let a scheduler mark a canonical scope (from the 5a dictionary) as "coarse"
and define the finer scopes it should really be split into. Surface a
**Completeness** page that flags every activity currently mapped to a coarse
scope, showing the suggested finer breakdown, with a per-activity dismiss so
the list narrows to genuinely actionable items over time.

This is a read-only check on the latest import — like 5d, it never mutates
import snapshots or attempts to actually split an activity. Any real schedule
edit happens upstream in MS Project.

---

## 3. Product Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Flag mechanism | **Dictionary split-rules.** A coarse canonical scope explicitly maps to a set of finer scopes via a new global table. Project-type templates (coverage) deferred. |
| Authoring | **Inline on the existing Normalize page.** A new "Split rules" section, separate panel from the raw-name mapping list, not a new nav item. |
| Surface | **Dedicated "Completeness" page**, mirroring the Schedule Health (5d) pattern. |
| Dismissal | **Per-activity dismiss**, persisted so the list narrows over time. |
| Dismissal key | **`canonicalActivityKey`** (wbs+name), matching `ProgressEntry`'s precedent — survives re-imports of an updated schedule file, unlike a `scheduleImportId`+`externalUid` key which would reset every re-import. |

---

## 4. Data Model

Two new tables + a migration.

```prisma
model ScopeSplitRule {
  id          String   @id @default(cuid())
  coarseScope String                      // a canonicalScope value from the scope dictionary
  finerScope  String                      // one of the finer scopes it should split into
  createdBy   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([coarseScope, finerScope])
  @@index([coarseScope])
}

model CompletenessDismissal {
  id                   String   @id @default(cuid())
  projectId            String
  project              Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  canonicalActivityKey String              // stable across re-imports
  coarseScope          String              // which rule is being dismissed for this activity
  dismissedBy          String?
  note                 String?
  createdAt            DateTime @default(now())

  @@unique([projectId, canonicalActivityKey, coarseScope])
  @@index([projectId])
}
```

- One row per `(coarseScope, finerScope)` pair — adding/removing a single
  finer scope is a single insert/delete, no array mutation.
- `CompletenessDismissal` keys on `coarseScope` in addition to
  `canonicalActivityKey` + `projectId`: if a normalization correction later
  changes which canonical scope an activity maps to, an old dismissal doesn't
  silently suppress a now-different flag.
- `ScopeSplitRule` is global, like `ScopeDictionaryEntry` and
  `TradeDictionaryEntry` — compounds across projects.
- Forward-compat: portable cuid IDs, dated rows, string `createdBy`/
  `dismissedBy` — consistent with Slices 1–5b.

---

## 5. Authoring UX — extending the Normalize page

`app/projects/[id]/normalize/page.tsx` gains a second section, **"Split
rules"**, below the existing mapped/unmapped review:

- Lists existing rules grouped by coarse scope; each finer scope shown as a
  removable chip (`×` → `DELETE`, removing just that one pair).
- An "Add split rule" form: coarse-scope field (datalist of `knownScopes`) +
  finer-scope field (free text, same datalist available) + "Add" button →
  `POST`, upserting one `(coarseScope, finerScope)` row.

New component `components/SplitRulesPanel.tsx` (client), a sibling to
`NormalizePanel`, not merged into it — "map this raw name" and "this scope is
coarse" stay independently scannable on one page.

**`lib/completeness/splitRuleService.ts`** (DB):
- `getSplitRules(): Promise<Map<string, string[]>>` — coarseScope → finerScopes.
- `addSplitRule(coarseScope, finerScope, createdBy?): Promise<void>` — upsert.
- `removeSplitRule(coarseScope, finerScope): Promise<void>` — delete one pair.

**`app/api/completeness/split-rules/route.ts`** — `POST`/`DELETE`, body
`{ coarseScope, finerScope }`. Global, no `projectId` (mirrors
`/api/normalize`).

---

## 6. Check Logic, Service, Page & Dismiss

Mirrors the Health (5d) split between pure checks and a DB-backed service.

**`lib/completeness/completenessChecks.ts`** (pure, unit-testable):
- `checkCompleteness(mapped: CompletenessActivity[], splitRules: Map<string,string[]>): CompletenessIssue[]`
  — `CompletenessActivity = { canonicalActivityKey, externalId, wbsCode, name, canonicalScope: string | null }`.
  For each activity whose `canonicalScope` matches a coarse scope in
  `splitRules`, emit one `CompletenessIssue { canonicalActivityKey, externalId, wbsCode, name, coarseScope, finerScopes }`.
  Activities with no mapped scope, or a scope with no split rule, produce no
  issue.

**`lib/completeness/completenessService.ts`** (DB):
- `getCompleteness(projectId): Promise<{ hasImport: boolean; issues: CompletenessIssue[]; summary: { coarseScope: string; count: number }[] }>`
  — loads the latest import's leaf+active activities (same filter convention
  as `healthService`: skip `summary`/`project_summary` types and
  `isActive === false`), runs `applyDictionary` (reused from 5a) to resolve
  each activity's `canonicalScope`, runs `checkCompleteness` against
  `getSplitRules()`, then filters out any issue with a matching
  `CompletenessDismissal` row for this project.
- `dismissIssue(projectId, canonicalActivityKey, coarseScope, dismissedBy?, note?): Promise<void>`
  — upsert into `CompletenessDismissal`.

**`app/projects/[id]/completeness/page.tsx`** — server component, same shape
as the health page: summary line + data date + `CompletenessIssuesTable`;
empty-import guard.

**`components/CompletenessIssuesTable.tsx`** — client; same search/filter
shell as `HealthIssuesTable` (search by name/WBS/ID, filter by coarse scope),
but each row shows the finer-scope breakdown and a **"Dismiss"** button that
`POST`s to `/api/completeness/dismiss` and `router.refresh()`s, removing it
from view.

**`app/api/completeness/dismiss/route.ts`** — `POST { projectId, canonicalActivityKey, coarseScope, note? }`
→ `dismissIssue` → `{ ok: true }` / `{ error }` 422.

**`app/projects/[id]/page.tsx`** — add a "Completeness" nav link, alongside
Normalize/Trades/Health.

---

## 7. Telemetry Profile

**Explicit opt-out**, consistent with Slices 1–5b (no manifest/telemetry
infrastructure). Revisit trigger: Connect integration or a telemetry system
landing.

---

## 8. Testing

- **Unit** (`tests/completeness/completenessChecks.test.ts`, no DB): activity
  with a coarse scope is flagged with the correct finer breakdown; activity
  with an unmapped or non-coarse scope produces no issue; empty split-rules →
  no issues.
- **DB-gated** (`tests/completeness/splitRuleService.test.ts`): add/remove a
  rule; `getSplitRules` reflects it.
- **DB-gated** (`tests/completeness/completenessService.test.ts`,
  self-cleaning): split rule + matching activity → flagged; dismiss → issue
  disappears from a subsequent `getCompleteness` call; dismissal is
  project-scoped (doesn't suppress the same activity name in a different
  project).
- **Build** — completeness page + panels compile; routes present.
- **Smoke (manual)**: mark "MEP Rough" coarse with finer scopes via the
  Normalize page's Split rules section → Completeness page flags matching
  activities → Dismiss removes one → re-import the same file → the dismissal
  still suppresses that activity (`canonicalActivityKey` survives re-import).

---

## 9. Non-Goals (this slice)

- Project-type templates / "missing scope entirely" coverage detection —
  deferred to a future sub-slice once cross-project scope data exists to
  inform what a template should contain.
- Any LLM/AI suggestion of what the finer breakdown should be — fully manual
  authoring via the Split rules panel.
- Bulk dismiss, undo-dismiss, or a "show dismissed" toggle — single dismiss
  action only for v1.
- Actually splitting the activity in the app — read-only flag; real schedule
  edits happen upstream in MS Project, same posture as Health (5d).
- A managed canonical-scope taxonomy — split rules reference the same organic
  `canonicalScope` strings as 5a.

---

## 10. Dependencies & Compatibility

- **Depends on:** Slice 1 (`Activity` fields, leaf/active filter convention),
  Slice 5a (`getKnownScopes`, `applyDictionary`, the Normalize page/route to
  extend).
- **Reuses:** leaf+active filter convention (`lib/health/healthService.ts`),
  latest-import load pattern, read-only table patterns
  (`components/HealthIssuesTable.tsx`), DB-gated test convention, the flat
  body-scoped API route convention (`/api/normalize`, `/api/trades`).
- **Schema change:** two new tables (`ScopeSplitRule`, `CompletenessDismissal`)
  + migration, committed together per `CLAUDE.md` git convention.

---

## 11. Open Questions / Future Notes

- **Coverage/templates** (deferred): once enough projects have confirmed
  scopes via 5a, a project-type template ("a Hospital ED renovation should
  have these N scopes") becomes derivable from real data rather than
  hand-authored — revisit then.
- **Near-duplicate split rules**: like the organic scope dictionary, finer
  scopes are free strings and could drift ("Elec Rough-In" vs "Electrical
  Rough-In") — same future taxonomy-cleanup item already on the 5a/5b
  backlog.
