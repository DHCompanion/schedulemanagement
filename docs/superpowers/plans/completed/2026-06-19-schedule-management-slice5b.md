# Slice 5b — Trade Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Attribute each activity to a trade discipline (global, learning, from its 5a scope) and a trade-partner company (per discipline per project, from a global roster).

**Architecture:** Three new tables. A pure module splits project scopes into mapped/unmapped disciplines; a service reads/writes the global discipline dictionary, the partner roster, and per-project assignments; a two-section Trades screen confirms them. Read-time attribution; deterministic; reuses `suggestScopes`.

**Tech Stack:** Next.js 14, TypeScript strict, Prisma + PostgreSQL, Vitest.

## Global Constraints

- Deterministic, no AI. Read-time attribution; no snapshot mutation.
- Discipline dictionary is **global** (scope→discipline, learns). Company is **per discipline per project** from a global deduped `TradePartner` roster.
- Reuse `lib/normalize/suggestScopes.ts` (generic token-overlap ranker) for discipline + partner suggestions.
- No new test infra: pure → Vitest unit; DB → `describe.runIf(!!process.env.DATABASE_URL)` with `30000`ms timeout.
- `@/` alias = repo root. Run `npm run build` and `npm run test` before review.

---

## File Structure

**Created:** `lib/trades/applyTradeDictionary.ts`, `lib/trades/tradesService.ts`, `app/api/trades/route.ts`, `app/projects/[id]/trades/page.tsx`, `components/TradesPanel.tsx`, `tests/trades/applyTradeDictionary.test.ts`, `tests/trades/tradesService.test.ts`.
**Modified:** `prisma/schema.prisma` (3 tables + `Project` back-relation), `app/projects/[id]/page.tsx` (nav button).

---

## Task 1: Schema + migration

**Files:** Modify `prisma/schema.prisma`; create `prisma/migrations/<ts>_add_trade_attribution/migration.sql`.

- [ ] **Step 1: Snapshot** `cp prisma/schema.prisma /tmp/schema-prev.prisma`
- [ ] **Step 2: Add `tradeAssignments ProjectTradeAssignment[]` to `model Project`** (after its existing relations).
- [ ] **Step 3: Append the three models:**

```prisma
model TradeDictionaryEntry {
  id              String   @id @default(cuid())
  canonicalScope  String   @unique
  tradeDiscipline String
  timesConfirmed  Int      @default(1)
  createdBy       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model TradePartner {
  id          String   @id @default(cuid())
  name        String   @unique
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  assignments ProjectTradeAssignment[]
}

model ProjectTradeAssignment {
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

- [ ] **Step 4 (with `DATABASE_URL` set):** `npx prisma validate`; generate migration via `prisma migrate diff --from-schema-datamodel /tmp/schema-prev.prisma --to-schema-datamodel prisma/schema.prisma --script`; `npx prisma generate`; `npx prisma migrate deploy`. Expected: 3 `CREATE TABLE`, unique indexes, FKs; no changes to existing tables.
- [ ] **Step 5: Commit** `git commit -m "feat(db): add trade attribution tables"`

---

## Task 2: applyTradeDictionary (pure)

**Files:** Create `lib/trades/applyTradeDictionary.ts`, `tests/trades/applyTradeDictionary.test.ts`.

**Interfaces:** Produces `TradeMapResult = { mapped: { scope: string; discipline: string }[]; unmappedScopes: string[] }`; `applyTradeDictionaryWith(scopes: string[], dict: Map<string,string>): TradeMapResult`.

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from "vitest";
import { applyTradeDictionaryWith } from "@/lib/trades/applyTradeDictionary";

describe("applyTradeDictionaryWith", () => {
  it("splits mapped vs distinct unmapped scopes", () => {
    const dict = new Map([["Electrical Rough-In", "Electrical"]]);
    const res = applyTradeDictionaryWith(["Electrical Rough-In", "Electrical Rough-In", "Plumbing Top-Out"], dict);
    expect(res.mapped).toEqual([{ scope: "Electrical Rough-In", discipline: "Electrical" }]);
    expect(res.unmappedScopes).toEqual(["Plumbing Top-Out"]);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run tests/trades/applyTradeDictionary.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
export interface TradeMapResult {
  mapped: { scope: string; discipline: string }[];
  unmappedScopes: string[];
}

export function applyTradeDictionaryWith(scopes: string[], dict: Map<string, string>): TradeMapResult {
  const mapped: { scope: string; discipline: string }[] = [];
  const unmapped = new Set<string>();
  const seen = new Set<string>();
  for (const scope of scopes) {
    if (seen.has(scope)) continue;
    seen.add(scope);
    const discipline = dict.get(scope);
    if (discipline) mapped.push({ scope, discipline });
    else unmapped.add(scope);
  }
  return { mapped, unmappedScopes: [...unmapped] };
}
```

- [ ] **Step 4:** Run test → PASS. **Step 5:** Commit `feat(trades): pure scope→discipline mapping`.

---

## Task 3: tradesService (DB)

**Files:** Create `lib/trades/tradesService.ts`, `tests/trades/tradesService.test.ts`.

**Interfaces:** `getTradeDictionary()`, `getKnownDisciplines()`, `confirmDiscipline(scope, discipline)`, `getTradePartners()`, `getProjectAssignments(projectId)`, `assignTradePartner(projectId, discipline, companyName)`.

- [ ] **Step 1: DB-gated test**

```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { confirmDiscipline, getTradeDictionary, getKnownDisciplines, assignTradePartner, getProjectAssignments, getTradePartners } from "@/lib/trades/tradesService";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("tradesService", () => {
  let projectId = "";
  const scopes: string[] = [];
  const partners: string[] = [];
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    if (scopes.length) await prisma.tradeDictionaryEntry.deleteMany({ where: { canonicalScope: { in: scopes } } });
    if (partners.length) await prisma.tradePartner.deleteMany({ where: { name: { in: partners } } });
    await prisma.$disconnect();
  });

  it("learns disciplines globally and assigns partners per project", async () => {
    const project = await prisma.project.create({ data: { name: "Trades Test" } });
    projectId = project.id;
    const scope = `ZZ Scope ${Date.now()}`;
    const company = `ZZ Co ${Date.now()}`;
    scopes.push(scope);
    partners.push(company);

    await confirmDiscipline(scope, "Electrical");
    expect((await getTradeDictionary()).get(scope)).toBe("Electrical");
    expect(await getKnownDisciplines()).toContain("Electrical");

    // correction bumps timesConfirmed
    await confirmDiscipline(scope, "Electrical-Low-Voltage");
    const e = await prisma.tradeDictionaryEntry.findUnique({ where: { canonicalScope: scope } });
    expect(e?.tradeDiscipline).toBe("Electrical-Low-Voltage");
    expect(e?.timesConfirmed).toBe(2);

    // partner: created once, assigned per project, reassignment updates
    await assignTradePartner(project.id, "Electrical-Low-Voltage", company);
    expect((await getProjectAssignments(project.id)).get("Electrical-Low-Voltage")).toBe(company);
    expect(await getTradePartners()).toContain(company);
    await assignTradePartner(project.id, "Electrical-Low-Voltage", company); // idempotent name reuse
    expect(await prisma.tradePartner.count({ where: { name: company } })).toBe(1);
  }, 30000);
});
```

- [ ] **Step 2:** Run `npm run test -- tests/trades/tradesService.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
import { prisma } from "@/lib/db";

export async function getTradeDictionary(): Promise<Map<string, string>> {
  const rows = await prisma.tradeDictionaryEntry.findMany();
  return new Map(rows.map((r) => [r.canonicalScope, r.tradeDiscipline]));
}

export async function getKnownDisciplines(): Promise<string[]> {
  const rows = await prisma.tradeDictionaryEntry.findMany({
    distinct: ["tradeDiscipline"], select: { tradeDiscipline: true }, orderBy: { tradeDiscipline: "asc" },
  });
  return rows.map((r) => r.tradeDiscipline);
}

export async function confirmDiscipline(canonicalScope: string, discipline: string): Promise<void> {
  const scope = canonicalScope.trim();
  const disc = discipline.trim();
  if (!scope || !disc) return;
  await prisma.tradeDictionaryEntry.upsert({
    where: { canonicalScope: scope },
    create: { canonicalScope: scope, tradeDiscipline: disc },
    update: { tradeDiscipline: disc, timesConfirmed: { increment: 1 } },
  });
}

export async function getTradePartners(): Promise<string[]> {
  const rows = await prisma.tradePartner.findMany({ select: { name: true }, orderBy: { name: "asc" } });
  return rows.map((r) => r.name);
}

export async function getProjectAssignments(projectId: string): Promise<Map<string, string>> {
  const rows = await prisma.projectTradeAssignment.findMany({ where: { projectId }, include: { tradePartner: true } });
  return new Map(rows.map((r) => [r.tradeDiscipline, r.tradePartner.name]));
}

export async function assignTradePartner(projectId: string, discipline: string, companyName: string): Promise<void> {
  const disc = discipline.trim();
  const name = companyName.trim();
  if (!disc || !name) return;
  const partner = await prisma.tradePartner.upsert({ where: { name }, create: { name }, update: {} });
  await prisma.projectTradeAssignment.upsert({
    where: { projectId_tradeDiscipline: { projectId, tradeDiscipline: disc } },
    create: { projectId, tradeDiscipline: disc, tradePartnerId: partner.id },
    update: { tradePartnerId: partner.id },
  });
}
```

- [ ] **Step 4:** Run test → PASS (with DB). **Step 5:** Commit `feat(trades): discipline dictionary + per-project partner assignment service`.

---

## Task 4: /api/trades route

**Files:** Create `app/api/trades/route.ts`; extend `tests/trades/tradesService.test.ts` with a route test.

- [ ] **Step 1: Add route test** (inside the `describe.runIf(hasDb)` block):

```ts
  it("route persists disciplines and assignments", async () => {
    const { POST } = await import("@/app/api/trades/route");
    const project = await prisma.project.create({ data: { name: "Trades Route Test" } });
    const scope = `ZZ RouteScope ${Date.now()}`;
    const company = `ZZ RouteCo ${Date.now()}`;
    scopes.push(scope); partners.push(company);
    const req = new Request("http://localhost/api/trades", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, disciplines: [{ canonicalScope: scope, discipline: "Plumbing" }], assignments: [{ discipline: "Plumbing", companyName: company }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect((await getTradeDictionary()).get(scope)).toBe("Plumbing");
    expect((await getProjectAssignments(project.id)).get("Plumbing")).toBe(company);
    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);
```

- [ ] **Step 2:** Run → FAIL (route missing).
- [ ] **Step 3: Implement**

```ts
import { NextResponse } from "next/server";
import { confirmDiscipline, assignTradePartner } from "@/lib/trades/tradesService";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    projectId?: string;
    disciplines?: { canonicalScope: string; discipline: string }[];
    assignments?: { discipline: string; companyName: string }[];
  };
  if (!body.projectId) {
    return NextResponse.json({ error: { message: "projectId required." } }, { status: 422 });
  }
  try {
    for (const d of body.disciplines ?? []) {
      if (d?.canonicalScope && d?.discipline) await confirmDiscipline(d.canonicalScope, d.discipline);
    }
    for (const a of body.assignments ?? []) {
      if (a?.discipline && a?.companyName) await assignTradePartner(body.projectId, a.discipline, a.companyName);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(trades): API route to persist disciplines and assignments`.

---

## Task 5: Trades page + panel + nav

**Files:** Create `components/TradesPanel.tsx`, `app/projects/[id]/trades/page.tsx`; modify `app/projects/[id]/page.tsx`.

- [ ] **Step 1: Client panel** — create `components/TradesPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DisciplineRow { canonicalScope: string; suggestions: string[]; }
export interface AssignmentRow { discipline: string; currentCompany: string; }

export function TradesPanel({ projectId, disciplineRows, assignmentRows, knownDisciplines, partners }: {
  projectId: string; disciplineRows: DisciplineRow[]; assignmentRows: AssignmentRow[]; knownDisciplines: string[]; partners: string[];
}) {
  const router = useRouter();
  const [disc, setDisc] = useState<Record<string, string>>({});
  const [comp, setComp] = useState<Record<string, string>>(() => Object.fromEntries(assignmentRows.map((r) => [r.discipline, r.currentCompany])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const disciplines = Object.entries(disc).filter(([, v]) => v.trim()).map(([canonicalScope, discipline]) => ({ canonicalScope, discipline: discipline.trim() }));
    const assignments = Object.entries(comp).filter(([, v]) => v.trim()).map(([discipline, companyName]) => ({ discipline, companyName: companyName.trim() }));
    const res = await fetch("/api/trades", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, disciplines, assignments }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json())?.error?.message ?? "Save failed."); return; }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <datalist id="known-disciplines">{knownDisciplines.map((d) => <option key={d} value={d} />)}</datalist>
      <datalist id="known-partners">{partners.map((p) => <option key={p} value={p} />)}</datalist>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Scope → discipline (global)</h2>
        {disciplineRows.length === 0 ? (
          <p className="text-sm text-slate-500">No scopes need a discipline.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
            {disciplineRows.map((r) => (
              <li key={r.canonicalScope} className="px-3 py-3">
                <div className="font-medium">{r.canonicalScope}</div>
                {r.suggestions.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.suggestions.map((s) => (
                      <button key={s} onClick={() => setDisc((v) => ({ ...v, [r.canonicalScope]: s }))} className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">{s}</button>
                    ))}
                  </div>
                )}
                <input list="known-disciplines" value={disc[r.canonicalScope] ?? ""} onChange={(e) => setDisc((v) => ({ ...v, [r.canonicalScope]: e.target.value }))} placeholder="Trade discipline" className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Discipline → trade partner (this project)</h2>
        {assignmentRows.length === 0 ? (
          <p className="text-sm text-slate-500">Map scopes to disciplines and save, then assign companies here.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
            {assignmentRows.map((r) => (
              <li key={r.discipline} className="px-3 py-3">
                <div className="font-medium">{r.discipline}</div>
                <input list="known-partners" value={comp[r.discipline] ?? ""} onChange={(e) => setComp((v) => ({ ...v, [r.discipline]: e.target.value }))} placeholder="Trade partner company" className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <button disabled={busy} onClick={save} className="self-start rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
    </div>
  );
}
```

- [ ] **Step 2: Server page** — create `app/projects/[id]/trades/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/normalize/normalizationService";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { suggestScopes } from "@/lib/normalize/suggestScopes";
import { getTradeDictionary, getKnownDisciplines, getTradePartners, getProjectAssignments } from "@/lib/trades/tradesService";
import { applyTradeDictionaryWith } from "@/lib/trades/applyTradeDictionary";
import { TradesPanel, type DisciplineRow, type AssignmentRow } from "@/components/TradesPanel";

export const dynamic = "force-dynamic";

export default async function TradesPage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const latest = await prisma.scheduleImport.findFirst({ where: { projectId: project.id }, orderBy: { importedAt: "desc" }, include: { activities: true } });
  const leaves = (latest?.activities ?? []).filter((a) => a.type !== "summary" && a.type !== "project_summary");

  const scopeDict = await getDictionary();
  const scopesPresent = new Set<string>();
  let unnormalizedCount = 0;
  for (const a of leaves) {
    const scope = scopeDict.get(normalizeName(a.name));
    if (scope) scopesPresent.add(scope);
    else unnormalizedCount++;
  }

  const tradeDict = await getTradeDictionary();
  const { mapped, unmappedScopes } = applyTradeDictionaryWith([...scopesPresent], tradeDict);
  const knownDisciplines = await getKnownDisciplines();
  const partners = await getTradePartners();
  const assignments = await getProjectAssignments(project.id);

  const disciplineRows: DisciplineRow[] = unmappedScopes.map((scope) => ({ canonicalScope: scope, suggestions: suggestScopes(scope, knownDisciplines) }));
  const disciplinesPresent = [...new Set(mapped.map((m) => m.discipline))].sort();
  const assignmentRows: AssignmentRow[] = disciplinesPresent.map((discipline) => ({ discipline, currentCompany: assignments.get(discipline) ?? "" }));

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Trades</h1>
      <p className="mb-4 text-sm text-slate-500">
        {mapped.length} scopes mapped to a discipline · {disciplineRows.length} to review
        {unnormalizedCount > 0 ? ` · ${unnormalizedCount} activities need normalizing first` : ""}
      </p>
      {!latest ? (
        <p className="text-slate-500">Import a schedule first.</p>
      ) : (
        <TradesPanel projectId={project.id} disciplineRows={disciplineRows} assignmentRows={assignmentRows} knownDisciplines={knownDisciplines} partners={partners} />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Nav button** — in `app/projects/[id]/page.tsx`, add into the cluster (after the Normalize link):

```tsx
          <Link href={`/projects/${project.id}/trades`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Trades
          </Link>
```

- [ ] **Step 4: Gate** — `npm run test && npm run build` → tests pass, build exit 0, `/projects/[id]/trades` present.
- [ ] **Step 5: Commit** `feat(trades): trades screen, panel, and nav link`.

---

## Manual Smoke Test
1. Normalize a project (5a) so scopes exist → **Trades**.
2. Section 1: assign disciplines to a couple scopes (chips/type) → **Save**.
3. Page refreshes: those scopes now count as mapped; Section 2 lists their disciplines → assign a company each → **Save**.
4. Open a second project sharing a scope → its discipline auto-inherits (global); assign its own company (per-project).

## Self-Review
- Spec coverage: §4 tables → T1; §5 pure → T2; §6 service → T3; §7 route/page/panel → T4,T5; §9 testing → unit (T2), DB-gated (T3,T4), build/smoke (T5). Non-goals respected (no analytics, no AI, one company/discipline/project).
- Placeholders: none. Type consistency: `TradeMapResult`/`applyTradeDictionaryWith` (T2) used in T5 page; service signatures (T3) consumed by T4 route + T5 page; `DisciplineRow`/`AssignmentRow` (T5 panel) consumed by T5 page; `suggestScopes` reused.
