# Schedule Management Tool — Slice 5b Design Spec (Trade Attribution)

**Date:** 2026-06-19
**Status:** Design approved; ready for implementation planning
**Owner:** Skiles Group (AJ Woodyard)
**Location:** `/home/coder/projects/Skilesconnect/schedulemanagement`
**Builds on:** Slice 1 (canonical model) + Slice 5a (normalized scopes). Second sub-slice of Slice 5.

---

## 1. Slice Goal

Attribute each activity to **who does the work**, in two layers:

- **Trade discipline** (Electrical, Plumbing, …) — derived from the 5a canonical
  scope via a **global, learning** dictionary (`scope → discipline`).
- **Trade partner** (the actual subcontractor company) — assigned **per discipline
  per project**, from a global, deduped company roster.

This captures the attribution data that future performance/workload analysis
(goal #5) will consume. It does **not** compute analytics itself.

Deterministic, no AI (per `CLAUDE.md` Don't-Build-Yet) — dictionary + heuristics,
consistent with 5a. Read-time attribution; no mutation of import snapshots.

---

## 2. Attribution Chain (read-time)

```
activity.name
  → [5a] normalizeName → ScopeDictionaryEntry → canonical scope
  → [5b] TradeDictionaryEntry[scope]          → trade discipline   (global)
  → [5b] ProjectTradeAssignment[project, discipline] → TradePartner → company (per-project)
```

Any link can be absent (not yet normalized / no discipline / no company) — the
chain degrades gracefully and the UI surfaces what's missing.

---

## 3. Product Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| What we attribute | **Both**: trade discipline (global) **and** trade-partner company (per-project). |
| Company granularity | **Per discipline per project** — one company per discipline per job. |
| Discipline list | **Organic** (free-text, learns; autocomplete from known), like 5a scopes. |
| Discipline mechanism | Global learning dictionary `scope → discipline`; exact auto-map + fuzzy suggestions; confirmation required. |
| Partner identity | Global `TradePartner` deduped by name, so the same sub aggregates across projects. |

---

## 4. Data Model

Three new tables + a migration. No changes to existing tables (`Project` gains a
back-relation only).

```prisma
model TradeDictionaryEntry {          // global: canonical scope -> trade discipline (learns)
  id              String   @id @default(cuid())
  canonicalScope  String   @unique
  tradeDiscipline String
  timesConfirmed  Int      @default(1)
  createdBy       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model TradePartner {                  // global roster of subcontractor companies
  id          String   @id @default(cuid())
  name        String   @unique
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  assignments ProjectTradeAssignment[]
}

model ProjectTradeAssignment {        // per-project: which company does each discipline
  id              String       @id @default(cuid())
  projectId       String
  project         Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  tradeDiscipline String
  tradePartnerId  String
  tradePartner    TradePartner @relation(fields: [tradePartnerId], references: [id], onDelete: Cascade)
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@unique([projectId, tradeDiscipline])
  @@index([projectId])
}
```

Back-relation added: `Project.tradeAssignments ProjectTradeAssignment[]`.
Forward-compat: portable cuid IDs, dated rows, `createdBy` string deferring real
actor identity — consistent with prior slices.

---

## 5. Logic (pure, unit-testable)

### 5.1 Reuse `suggestScopes`
`lib/normalize/suggestScopes.ts` is a generic token-overlap (Jaccard) ranker over
strings. Reuse it as-is to rank **disciplines** for a scope name and to rank the
**partner roster** for a typed company — no new ranking module.

### 5.2 `lib/trades/applyTradeDictionary.ts`
`applyTradeDictionaryWith(scopes: string[], dict: Map<string,string>): { mapped: { scope: string; discipline: string }[]; unmappedScopes: string[] }`
— splits distinct canonical scopes into mapped (discipline known) vs distinct
unmapped. Mirrors 5a's `applyDictionaryWith`. Input is the set of distinct
canonical scopes present on the project (from 5a).

---

## 6. Service Layer (DB)

`lib/trades/tradesService.ts`:

- **Discipline (global):**
  - `getTradeDictionary(): Promise<Map<string,string>>` — `canonicalScope → discipline`.
  - `getKnownDisciplines(): Promise<string[]>` — distinct disciplines (autocomplete + suggestions).
  - `confirmDiscipline(canonicalScope, discipline): Promise<void>` — upsert by
    `canonicalScope`; on conflict set discipline + increment `timesConfirmed`
    (handles corrections).
- **Partner (per-project):**
  - `getTradePartners(): Promise<string[]>` — roster names (autocomplete).
  - `getProjectAssignments(projectId): Promise<Map<string,string>>` — `discipline → company name`.
  - `assignTradePartner(projectId, discipline, companyName): Promise<void>` —
    get-or-create `TradePartner` by trimmed name, then upsert
    `ProjectTradeAssignment` by `[projectId, discipline]` (reassignment updates).

---

## 7. Workflow, Routes & Components

One **"Trades"** screen per project, two sections; mirrors the 5a review pattern.

### 7.1 Flow
1. Project page gains a **"Trades"** nav button.
2. **Trades page** loads the import's leaf activities, resolves their 5a canonical
   scopes, and computes:
   - **Section 1 — Disciplines (global):** distinct mapped scopes with **no**
     discipline yet → each row = scope + ranked discipline suggestions (via
     `suggestScopes` over `getKnownDisciplines`) + free-text/autocomplete. Scopes
     **not yet normalized in 5a** are surfaced as a "normalize these first" nudge
     (not assignable here).
   - **Section 2 — Trade partners (per project):** each discipline present on the
     project → assign a company (autocomplete from `getTradePartners`, or type a
     new one); shows the current assignment if any.
3. One **Save** → `POST /api/trades`. A summary lists resolved scope → discipline → company.

### 7.2 Routes
- `app/projects/[id]/trades/page.tsx` — the two-section screen (server component).
- `app/api/trades/route.ts` — `POST` body
  `{ disciplines: { canonicalScope, discipline }[]; assignments: { discipline, companyName }[] }`
  → `confirmDiscipline` each, `assignTradePartner(projectId, …)` each →
  `{ ok: true }` / `{ error }` 422. `projectId` in the body.

### 7.3 Components
- `components/TradesPanel.tsx` (client) — both sections + single Save + inline errors.

---

## 8. Telemetry Profile

**Explicit opt-out**, consistent with Slices 1–5a. Revisit trigger: Connect
integration or a telemetry system landing; discipline confirmations and partner
assignments are natural learning-signal events then.

---

## 9. Testing

- **Unit** — `applyTradeDictionaryWith`: mapped vs distinct-unmapped split; dedupe.
- **DB-gated** — `tradesService`: `confirmDiscipline` learn + correct + cross-project
  reuse; `assignTradePartner` creates a partner once, reuses by name, upserts the
  per-project assignment, and reassignment updates it; `getProjectAssignments`
  returns the right discipline→company map.
- **DB-gated (route)** — `POST /api/trades` persists disciplines + assignments; bad
  body → 422.
- **Build** — trades page + panel compile; route present.
- **Smoke (manual)** — normalize a project (5a) → Trades → assign disciplines to a
  couple scopes → assign a company per discipline → Save → re-open shows them
  mapped; a second project sharing a scope auto-inherits the discipline (global),
  and you assign its own company (per-project).

---

## 10. Non-Goals (later)

- Multiple subs per discipline on one project; per-scope company overrides.
- Any LLM/AI.
- Performance / workload **analytics** (the payoff that consumes this data — later slice).
- Scope/discipline/company column in the verification view (nice-to-have; deferred).
- Near-duplicate discipline/partner cleanup (a managed-taxonomy refinement).
- Mutating import snapshots.

---

## 11. Dependencies & Compatibility

- **Depends on:** Slice 1 (`Activity.name`, leaf `type`) + Slice 5a
  (`ScopeDictionaryEntry`, `normalizeName`, `applyDictionary`, `suggestScopes`).
- **Reuses:** `suggestScopes` (generic ranker), the 5a review-screen pattern, the
  DB-gated test convention, server-page + client-form patterns.
- **Schema change:** three new tables + migration (committed together).

---

## 12. Open Questions / Future Notes

- **Multi-sub per discipline:** the `@@unique([projectId, tradeDiscipline])`
  assumes one company per discipline per job; splitting by area/scope is a future
  refinement.
- **Roster hygiene:** free-text company names risk near-duplicates ("ABC Electric"
  vs "ABC Electric Co."); a managed roster with merge is future.
- **Analytics:** discipline + partner attribution is the input to cross-project
  performance/workload (goal #5), designed in a later slice.
