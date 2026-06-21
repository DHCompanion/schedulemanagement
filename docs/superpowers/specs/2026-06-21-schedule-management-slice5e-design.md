# Schedule Management Tool — Slice 5e Design Spec (Workflow Integration)

**Date:** 2026-06-21
**Status:** Design approved; ready for implementation planning
**Owner:** Skiles Group (AJ Woodyard)
**Location:** `/home/coder/projects/Skilesconnect/schedulemanagement`
**Builds on:** Slice 1 (import + canonical model), Slice 5a (Normalize/scope dictionary),
Slice 5c (Completeness/split rules), Slice 5d (Schedule health), Export module.

---

## 1. Context

Slices 5a (Normalize), 5c (Completeness), and 5d (Schedule health) each shipped as
independent, read-time overlay pages with no relationship to one another and no
suggested order. In practice they form a pipeline: upload a schedule, clean up bad
data, give every activity a consistent name, flag and resolve coarse tracking, then
work the schedule week to week. That pipeline was never made visible, and several
gaps surfaced once it was walked through end to end:

- **Completeness's coarse-scope check silently skips never-before-seen activity
  names.** It depends on Normalize having already mapped a name to a canonical
  scope; an unmapped activity produces no flag and no warning — it just looks
  clean by omission.
- **`ScopeSplitRule` (the table that drives Completeness) ships with zero rows
  and no UI nudge to populate it.** On the production project, 54 dictionary
  entries exist and zero split rules — Completeness has never flagged anything,
  not because schedules are clean but because nobody has had a reason to visit
  the disconnected global "Split rules" form.
- **Normalize only renames activities for in-app display.** The canonical name
  never reaches the schedule that goes back to MS Project via Export — the
  "make activities named the same" goal stops at the app boundary today.
- **Schedule health's date-sanity checks and the "is this schedule basically
  healthy" question were never one view.** A scheduler has to mentally combine
  4 separate issue checks with no completion metric to answer "are we in good
  shape."
- **Nothing orients a first-time user.** A brand-new project's first import
  drops you on the project page with 7 independent nav links and no indication
  of what to do first.

This spec is the integration layer across 5a/5c/5d plus the Export module — it does
not change any of their core check/match logic, only how they're sequenced,
surfaced, and (for Normalize) how far the result reaches.

**Deterministic, no AI**, per `CLAUDE.md` "Don't Build Yet" — same constraint as
5a/5b/5c/5d.

---

## 2. Slice Goal

1. Make the real workflow (**Import → Schedule health → Normalize activity names →
   Completeness → Trades → Weekly updates → Export**) visible and easy to follow,
   without hard-gating any page outside of a first-time setup wizard.
2. Walk a project through that wizard once, on its first import, so a new user
   isn't dropped on an unordered nav with no context.
3. Close the Completeness coverage gap by reordering Normalize before
   Completeness and by moving split-rule authoring inline onto the Normalize
   page, where it has a chance of actually being used.
4. Make Schedule health answer "is this schedule healthy" at a glance — a
   progress metric plus 4 clearly-sectioned issue checks — instead of being a
   flat issue list.
5. Make normalized activity names actually reach the schedule that's exported
   back to MS Project.
6. Restrict split-rule authoring/removal to a tool-admin session, since a typo
   or careless rule here silently suppresses real Completeness signal for
   everyone.

---

## 3. Product Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Page order | **Guidance only, no hard gate** outside the first-time wizard. Project page nav reorders to Import → Schedule health → Normalize activity names → Completeness → Trades → Weekly updates → Export. All pages stay independently reachable once a project has completed onboarding. |
| First-time onboarding | **A 3-step wizard** (Health → Normalize → Completeness) forced on a project's first-ever import. Each step shows the real page content plus a one-line "why." Steps are **acknowledge-based** (click Next/Finish), not resolution-gated — some issues (bad dates) can only be fixed by re-importing from MS Project, so the wizard can't require zero issues to proceed. |
| "Non-feasible" / way-in-the-past dates | **Stay in Schedule health** as the existing `out_of_envelope` check. Not duplicated or moved into Completeness. |
| Schedule health layout | **One page**, sectioned: a Progress block (total / completed / remaining / % complete) followed by the 4 existing checks, each its own header showing "0 issues — clean" or its list. |
| Completeness coverage gap | **Fixed by reordering, not by changing match logic.** Normalize now runs before Completeness so every activity has a canonical scope before the coarse-scope check runs. |
| Split-rule authoring | **Inline on the Normalize page**, per unmapped-name row, next to the canonical-scope field — not a heuristic/automatic coarseness detector. Because the dictionary is global, this control resurfaces any time a *new* raw name reuses an *existing* canonical scope, so already-in-use scopes remain reachable without a separate "browse all scopes" view. |
| Split-rule access | **Tool-admin only.** New `APP_ADMIN_PASSWORD` env var + elevated session flag, same pattern as the existing single shared `APP_PASSWORD`. No real user/role system. |
| Normalize → Export | **Canonical name is injected into the exported XML**, parallel to the existing actuals injection — literal replacement of `Task.Name` with the canonical scope for any activity with a dictionary mapping. No DB mutation; matches the immutable-imports rule. Per-row qualifier preservation (so visually-identical rows stay distinguishable in MS Project) is **noted, not built** — WBS already carries that distinction. |

---

## 4. Data Model

One column addition, no new tables.

```prisma
model Project {
  // ...existing fields...
  onboardingCompletedAt DateTime?
}
```

- Null means "show the first-time wizard on this project's next/first import
  review." Set once the wizard's Completeness step is finished.
- **Migration backfill:** existing projects get `onboardingCompletedAt = now()`
  in the same migration that adds the column, so projects that already have an
  import are not retroactively forced into the wizard.

Admin gating reuses the existing cookie-based pattern (`lib/auth.ts`) — no new
table. A second cookie (or a second value alongside the existing session token)
records elevated/admin status, set only when the login form is submitted with
`APP_ADMIN_PASSWORD` instead of `APP_PASSWORD`.

---

## 5. First-Time Setup Wizard

**Trigger:** after a project's import commit, if this is the project's first
`ScheduleImport` ever **and** `onboardingCompletedAt` is null, redirect to the
wizard instead of the normal project page.

**Steps**, each embedding the existing page's real content plus a one-line why:

1. **Health** — *"Catch bad or implausible dates before anything else, since a
   bad date can throw off everything downstream."*
2. **Normalize activity names** — *"Give every activity a consistent standard
   name so reporting and rollups work, and flag any scope that's too coarse to
   track meaningfully."*
3. **Completeness** — *"Review the coarse-scope issues you just flagged and
   decide what to do — split it in MS Project and re-import, or dismiss it."*

**Behavior:**
- Linear stepper with Back/Next; no jumping to unrelated pages until Finish.
- Acknowledge-based: Next/Finish work regardless of remaining open issues.
- Finish sets `onboardingCompletedAt = now()` and redirects to the normal,
  fully-navigable project page.
- Implemented as a wizard shell that reuses the existing Health/Normalize/
  Completeness server components and client panels — no duplicated check or
  service logic, only step framing, the why-blurb, and step navigation.

---

## 6. Schedule Health — Page Redesign

`app/projects/[id]/health/page.tsx` gains a **Progress** section above the
existing issue list:

- **Total** — leaf+active activities (existing `isLeafActive` filter).
- **Completed** — `percentComplete === 100`.
- **Remaining** — `total - completed`.
- **% complete** — `completed / total`, rounded.

The existing 4 checks (`out_of_envelope`, `future_actual`, `missing_dates`,
`percent_contradiction`) become individually-headed sections instead of one
flat sorted list — each shows "0 issues — clean" or its filtered list. No
change to `lib/health/dateChecks.ts` check logic; this is a presentation
change plus one new pure summarizer for the Progress numbers.

`out_of_envelope` (the existing "2025 mis-date catch" / way-in-the-past check)
stays here — it is not duplicated into Completeness.

---

## 7. Normalize Activity Names — Page, Authoring, and Export

### 7.1 Rename

"Normalize scopes" → **"Normalize activity names"** — page title, nav label,
breadcrumb. No route change (`/projects/[id]/normalize`).

### 7.2 Inline split authoring

Each row in the existing unmapped-name list (`NormalizePanel`) gains a "split
into finer scopes" control next to the canonical-scope field. Saving a row now
does two things instead of one:

1. `confirmMapping(rawName, canonicalScope)` — unchanged, existing behavior.
2. If finer scopes were entered: `addSplitRule(canonicalScope, finerScope)` for
   each — same `splitRuleService` function Slice 5c already has, just called
   from a new call site.

This control is **admin-only** (see §8). Because `ScopeDictionaryEntry` is
global, this row reappears any time a new raw name is mapped to an existing
canonical scope — including long-standing scopes — so already-in-use scopes
stay reachable for split-rule authoring without a dedicated "all scopes" view.
That view is explicitly out of scope for this slice (§10).

### 7.3 Split Rules panel (bottom of page)

Drops its free-text "add rule" form (that job moved inline, §7.2). Keeps
listing existing rules with a remove (`×`) button — **admin-only** (§8).
Non-admin sessions see the list read-only, no add/remove controls.

### 7.4 Export: push canonical names into the XML

`lib/export/buildExport.ts` currently builds a `progressByUid` map and calls
`injectActuals`. This slice adds a parallel `nameByUid` map and an
`injectNames(doc, nameByUid)` function in `lib/export/injectActuals.ts` (or a
sibling `injectNames.ts`):

- For each of the latest import's activities, resolve `canonicalScope` via the
  existing `applyDictionary` (Slice 5a) — same global dictionary already used
  by Normalize/Completeness.
- Build `nameByUid: Map<number, string>` keyed on `externalUid` →
  `canonicalScope`, skipping activities with no mapping (original name is left
  untouched).
- `injectNames` mutates matching `<Task>` nodes' `Name` field in the
  in-memory parsed document — same mutate-in-place pattern as `injectActuals`,
  same `doc` object, called alongside it in `buildExport`.
- No change to `Activity.name` in the database — this is export-time only,
  consistent with "imports are immutable; normalization is a read-time
  overlay." The overlay now also reaches the *export* artifact, not just the
  in-app display.
- Literal replacement: `Task.Name = canonicalScope`. If many distinct raw
  names share one canonical scope (e.g. multiple floors all "Drywall Hang"),
  those rows become identically named in the exported file — distinguishable
  by WBS code/outline, same as within this app today. Preserving a per-row
  qualifier (e.g. extracting a floor/section token from the original name) is
  **not built this slice** — noted in §11 as a future idea if WBS structure
  alone proves insufficient in practice.

---

## 8. Admin Gating

**`lib/auth.ts`** gains:

- `process.env.APP_ADMIN_PASSWORD` — a second password, alongside the
  existing `APP_PASSWORD`.
- `isAdmin(cookieValue: string | undefined): boolean` — checks a second
  session-flag value (or a second cookie) set at login time when the admin
  password was used instead of the regular one.

**Login route** (`app/api/login/route.ts`) checks the submitted password
against both `APP_PASSWORD` and `APP_ADMIN_PASSWORD`; on an admin-password
match, set the elevated flag in addition to the regular session cookie.

**Enforcement points:**
- `app/api/normalize` route's *split-rule* additions (not the raw-name mapping
  POST, which is unaffected) — reject with 403 if not admin.
- `app/api/completeness/split-rules` route (`POST`/`DELETE`) — reject with 403
  if not admin.
- `SplitRulesPanel` and the new inline per-row split control render read-only
  (no inputs/buttons) for non-admin sessions.

This only gates split-rule add/remove. Every other existing capability
(import, normalize raw-name mapping, weekly updates, dismiss, export) is
unaffected and stays available to any authenticated session.

---

## 9. Testing

- **Unit** (`tests/health/dateChecks.test.ts`, extend): new pure summarizer for
  Progress metrics (total/completed/remaining/% complete) from a list of leaf
  activities.
- **Unit** (`tests/export/injectActuals.test.ts`, extend, or new
  `injectNames.test.ts`): a `<Task>` with a UID present in `nameByUid` gets its
  `Name` overwritten; a UID absent from the map is left untouched; existing
  actuals-injection behavior is unaffected by also calling `injectNames`.
- **DB-gated** (`tests/export/buildExport.test.ts`, extend): an activity with a
  confirmed dictionary mapping exports with the canonical name in the XML; an
  unmapped activity exports with its original name.
- **DB-gated** (`tests/completeness/splitRuleService.test.ts`, extend or new
  call site test): adding a split rule via the new inline-save path produces
  the same row shape as the existing `addSplitRule` path.
- **DB-gated** (`tests/auth.test.ts` or new): `isAdmin` returns true only for
  the admin-password session flag; split-rule routes return 403 for a
  non-admin session and 200 for an admin session.
- **Build** — wizard route(s) compile; reordered nav renders; admin-gated
  controls render read-only without the admin flag.
- **Smoke (manual):**
  1. New project, first import → lands in the wizard, not the project page;
     Next/Finish works through all 3 steps even with open Health issues;
     Finish lands on the normal project page with full nav.
  2. Re-import on that same project (or a second project's first import after
     this ships) → no wizard, normal project page directly — confirms the
     backfill/trigger condition.
  3. Log in with the regular password → Normalize's inline split control and
     the bottom Split Rules panel are read-only. Log in with the admin
     password → both are editable.
  4. As admin, map a new raw name to canonical scope "Drywall Hang" and add a
     split rule inline → Completeness flags it; Normalize page next visited
     by reusing "Drywall Hang" for a different raw name shows the existing
     split rule.
  5. Export with a normalized project → exported XML's matching `<Task>` Name
     fields show canonical scopes; an activity with no dictionary mapping
     keeps its original name.

---

## 10. Non-Goals (this slice)

- **Automatic/heuristic coarseness detection** (duration outliers, raw-name
  recurrence count, etc.) — split-rule authoring stays fully manual, just
  relocated inline. Considered and explicitly declined in favor of the inline
  UX.
- **A "browse all distinct canonical scopes in use" view** for retroactively
  marking long-standing scopes as coarse outside the inline-on-new-mapping
  flow. Deferred — the inline control already resurfaces for any scope that
  gets a new raw-name mapping, which is expected to be sufficient given the
  global dictionary compounds across projects.
- **Hard workflow gating** outside the first-time wizard — Health/Normalize/
  Completeness/Trades/Updates/Export remain independently reachable for any
  project that has completed onboarding.
- **Per-row name qualifier preservation** in the export name-injection — noted
  in §11, not built.
- **Real user accounts / role system** — admin gating is a second shared
  password, not per-user identity.
- **Resolution-gated wizard steps** — the wizard never requires zero issues to
  advance.

---

## 11. Dependencies & Compatibility

- **Depends on:** Slice 1 (`Activity` fields, leaf/active filter convention),
  Slice 5a (`applyDictionary`, `confirmMapping`, the Normalize page being
  extended), Slice 5c (`addSplitRule`/`removeSplitRule`, `ScopeSplitRule`,
  the Completeness page/check logic, unchanged), Slice 5d (`dateChecks.ts`,
  the Health page being extended), Export module (`buildExport.ts`,
  `injectActuals.ts`).
- **Reuses:** the global-dictionary pattern (5a/5b), the leaf+active filter
  convention, the existing single-shared-password auth pattern (extended, not
  replaced), the mutate-in-place XML injection pattern from `injectActuals`.
- **Schema change:** one column (`Project.onboardingCompletedAt`) + migration
  with backfill, committed together per `CLAUDE.md` git convention.

---

## 12. Open Questions / Future Notes

- **Per-row export qualifier preservation**: if literal canonical-scope
  replacement turns out to make exported MS Project files hard to read
  (multiple identically-named rows), revisit extracting a floor/section
  qualifier from the original raw name to append to the canonical name. Noted
  as a real risk, not built this slice — WBS structure is the recommended
  primary way to distinguish rows and may prove sufficient in practice.
- **"Browse all scopes" view**: if the inline-resurfacing-on-new-mapping
  pattern proves insufficient (e.g. a project's dictionary is fully stable and
  no new raw names ever reuse old scopes), revisit a dedicated view listing
  every distinct canonical scope in use on a project, each with the same
  inline split control, independent of whether any name is currently unmapped.
- **Wizard for re-imports**: this slice only forces the wizard on a project's
  very first import. Whether a *materially different* re-import (e.g. a much
  later schedule revision with many new activities) should re-trigger any
  part of the wizard is left for a future slice if it turns out to matter in
  practice.
