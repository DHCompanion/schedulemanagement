# Schedule Management Tool — Slice 5a Design Spec (Normalization Foundation)

**Date:** 2026-06-18
**Status:** Design approved; ready for implementation planning
**Owner:** Skiles Group (AJ Woodyard)
**Location:** `/home/coder/projects/Skilesconnect/schedulemanagement`
**Builds on:** Slice 1 (import + canonical model). First sub-slice of roadmap Slice 5.

---

## 1. Context & Decomposition

Roadmap Slice 5 (normalization + analytics) is several independent subsystems.
It is decomposed into sub-slices, each its own spec → plan → build:

| Sub-slice | Delivers | Depends on |
|-----------|----------|------------|
| **5a (this spec)** | Task-name normalization + global scope dictionary + confirm/learn loop | 1 |
| 5b | Trade-partner attribution from normalized scopes | 5a |
| 5c | Completeness check (split coarse activities, templates) | 5a |
| 5d | Schedule-health / date-sanity check (independent) | 1 |
| 5e | Cross-project aggregation for preliminary schedules | 5a, 5b |

This spec covers **5a only** — the keystone the others build on.

---

## 2. Slice Goal

Turn inconsistent raw task names into a consistent set of **standard scopes**, via
a global dictionary that **learns** from user confirmations. A confirmed mapping
(`raw name → standard scope`) auto-applies to every activity with that name across
all projects, so the work compounds over time.

**Deterministic, no AI.** Per `CLAUDE.md` "Don't Build Yet" (real Buddy/AI),
normalization is dictionary + heuristic matching only — no LLM.

---

## 3. Product Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Suggestion mechanism | **Exact-normalized auto-map + fuzzy assist.** Identical normalized names auto-map from confirmed entries; never-seen names get ranked token-similarity suggestions the user picks or overrides. No auto-apply of fuzzy matches. |
| Dictionary scope | **Global across all projects.** One org-wide dictionary; compounds fastest. |
| Mapping unit | **Task name** (not wbs+name) — confirming one name bulk-applies to all activities with that name, everywhere. |
| Storage | **Dictionary is the state; normalization computed at read time.** No mutation of immutable import snapshots; no re-import ever needed. |
| Standard-scope list | **Organic** — distinct `canonicalScope` values are the list; no separate taxonomy table in 5a. |

---

## 4. Data Model

One new **global** table (not project-scoped) + a migration.

```prisma
model ScopeDictionaryEntry {
  id             String   @id @default(cuid())
  normalizedName String   @unique          // normalizeName(rawName) — exact-match key
  canonicalScope String                    // the standard scope it maps to
  timesConfirmed Int      @default(1)       // confidence / ranking signal
  createdBy      String?                    // string for now, matches importedBy/submittedBy
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

- **No per-activity storage.** A normalized scope for any activity =
  `dictionary[normalizeName(activity.name)].canonicalScope` (or unmapped).
- Distinct `canonicalScope` values form the organic standard-scope list (drives
  autocomplete and fuzzy-suggestion candidates).
- Forward-compat: portable cuid IDs, dated rows, `createdBy` string deferring real
  actor identity — consistent with Slices 1–3.

---

## 5. Normalization Logic (pure, unit-testable)

### 5.1 `lib/normalize/normalizeName.ts`
`normalizeName(name: string): string` — lowercase, trim, collapse internal
whitespace to single spaces. This is the exact-match key. (Mirrors the
name-normalization already inside `canonicalKey`, but keyed on name alone.)

### 5.2 `lib/normalize/suggestScopes.ts`
`suggestScopes(rawName: string, knownScopes: string[], limit = 5): string[]` —
rank `knownScopes` by **Jaccard token overlap** with the raw name (word sets after
`normalizeName`), descending, ties broken by shorter scope; return up to `limit`.
Pure; no auto-apply — output is suggestions only.

---

## 6. Service Layer (DB)

`lib/normalize/normalizationService.ts`:

- `getDictionary(): Promise<Map<string, string>>` — `normalizedName → canonicalScope`.
- `applyDictionary(activities)`: returns
  `{ mapped: { activity, canonicalScope }[]; unmappedNames: string[] }` where
  `unmappedNames` are the **distinct** raw names (deduped) with no dictionary hit.
  Mapped uses exact `normalizeName` lookup.
- `confirmMapping(rawName: string, canonicalScope: string): Promise<void>` — upsert
  by `normalizedName`: create with `timesConfirmed = 1`, or on conflict set
  `canonicalScope` (handles corrections) and increment `timesConfirmed`.
- `getKnownScopes(): Promise<string[]>` — distinct `canonicalScope` values for
  autocomplete + `suggestScopes` candidates.

---

## 7. Workflow, Routes & Components

Mobile-first; follows existing server-page + client-form patterns.

### 7.1 Flow
1. Project page gains a **"Normalize scopes"** action (nav button).
2. **Normalize page** loads the latest import's **leaf** activities, runs
   `applyDictionary`, and shows:
   - **Unmapped** distinct names (the work): each row = a raw name + ranked
     `suggestScopes` chips + a free-text/autocomplete field (candidates =
     `getKnownScopes`). The count reflects how many activities share that name.
   - **Mapped** names: collapsed summary with their canonical scope.
3. The user assigns/confirms each distinct name once → **Save** → `POST /api/normalize`
   upserts entries. Future imports across all projects auto-map those names.

### 7.2 Routes
- `app/projects/[id]/normalize/page.tsx` — review screen (server component).
- `app/api/normalize/route.ts` — `POST`: body `{ mappings: { rawName, canonicalScope }[] }`
  → `confirmMapping` for each non-empty pair → JSON `{ ok: true }` / `{ error }` 422.

### 7.3 Components
- `components/NormalizePanel.tsx` (client) — the editable unmapped list + save.

---

## 8. Telemetry Profile

**Explicit opt-out**, consistent with Slices 1–3 (no manifest/telemetry
infrastructure). Revisit trigger: Connect integration or a telemetry system
landing; confirmed mappings are a natural learning-signal event then.

---

## 9. Testing

- **Unit** — `normalizeName`: case/whitespace folding; idempotent.
- **Unit** — `suggestScopes`: ranks higher-overlap scopes first; respects `limit`;
  empty `knownScopes` → empty.
- **DB-gated** — `normalizationService`: confirm → exact auto-map on a matching
  name; cross-project reuse (mapping confirmed via one project applies to another);
  correction updates `canonicalScope` and bumps `timesConfirmed`;
  `applyDictionary` dedupes unmapped names.
- **DB-gated (route)** — `POST /api/normalize` persists mappings; bad body → 422.
- **Build** — normalize page + panel compile; route present.
- **Smoke (manual)** — import → Normalize scopes → assign a few names → save →
  re-open: those names now show mapped; import another project sharing a name → it
  auto-maps.

---

## 10. Non-Goals (later sub-slices / future)

- Trade-partner attribution (5b), completeness check (5c), cross-project
  aggregation (5e), schedule-health/date-sanity (5d).
- Any LLM/AI suggestion.
- Mutating import snapshots / per-activity normalization storage.
- A managed canonical-scope taxonomy table (scopes stay organic strings).
- Auto-applying fuzzy matches without confirmation.
- Displaying scope as a column in the verification view (nice-to-have; deferred).

---

## 11. Dependencies & Compatibility

- **Depends on:** Slice 1 (`Activity.name`, leaf `type`, `parseMspXml`).
- **Reuses:** server-page + client-form patterns, `requestBaseUrl` if a redirect is
  used, the DB-gated test convention.
- **Schema change:** one new table + migration (committed together).

---

## 12. Open Questions / Future Notes

- **Scope taxonomy:** organic strings risk near-duplicate scopes ("Elec Rough-In"
  vs "Electrical Rough-In"); a managed/merge-able taxonomy is a future refinement.
- **Fuzzy tuning:** Jaccard token overlap is the starting heuristic; revisit
  (bigram Dice, synonyms) if suggestions underperform on real names.
- **Lineage tie-in:** the same normalization could later power fuzzy
  activity-lineage matching flagged in the Slice 2 spec.
