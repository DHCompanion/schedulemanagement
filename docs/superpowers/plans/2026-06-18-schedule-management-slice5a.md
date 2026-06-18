# Slice 5a — Normalization Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global, learning scope dictionary that normalizes raw task names to standard scopes via exact-match auto-mapping + fuzzy suggestions, with a per-import review screen to confirm/correct mappings.

**Architecture:** One new global table (`ScopeDictionaryEntry`). Pure modules normalize names and rank fuzzy suggestions; a service layer reads/writes the dictionary and splits an import's activities into mapped vs distinct-unmapped names; a server review page + client panel let the user confirm mappings, which upsert into the dictionary and auto-apply everywhere thereafter. Deterministic — no AI.

**Tech Stack:** Next.js 14 (App Router), TypeScript (strict), Prisma + PostgreSQL, Vitest.

## Global Constraints

- **Deterministic, no AI** (per `CLAUDE.md` Don't-Build-Yet). Dictionary + heuristics only.
- **Global dictionary** across all projects; **mapping unit is the task name** (not wbs+name).
- **Read-time normalization** — never mutate import snapshots; no per-activity storage.
- **`normalizeName`** = lowercase + trim + collapse internal whitespace. It is the exact-match key.
- **Fuzzy suggestions never auto-apply** — they require user confirmation.
- **No new test infra.** Pure → Vitest unit; DB → `describe.runIf(!!process.env.DATABASE_URL)` with `30000`ms timeout on multi-round-trip tests.
- **`@/` path alias** maps to repo root. Run `npm run build` and `npm run test` before review.

---

## File Structure

**Created:**
- `lib/normalize/normalizeName.ts` — the exact-match key function
- `lib/normalize/suggestScopes.ts` — pure Jaccard token-overlap ranking
- `lib/normalize/normalizationService.ts` — dictionary read/write + apply
- `app/api/normalize/route.ts` — POST confirm mappings
- `app/projects/[id]/normalize/page.tsx` — review screen
- `components/NormalizePanel.tsx` — client editable unmapped list
- `tests/normalize/normalizeName.test.ts`, `tests/normalize/suggestScopes.test.ts`, `tests/normalize/normalizationService.test.ts`

**Modified:**
- `prisma/schema.prisma` — add `ScopeDictionaryEntry`
- `app/projects/[id]/page.tsx` — add "Normalize scopes" nav button

---

## Task 1: Schema + migration for the scope dictionary

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_scope_dictionary/migration.sql`
- Test: `tests/normalize/normalizationService.test.ts` (DB round-trip portion)

**Interfaces:**
- Produces: Prisma model `ScopeDictionaryEntry` (global table).

- [ ] **Step 1: Snapshot schema for an offline diff**

```bash
cp prisma/schema.prisma /tmp/schema-prev.prisma
```

- [ ] **Step 2: Append the model to `prisma/schema.prisma`**

```prisma
model ScopeDictionaryEntry {
  id             String   @id @default(cuid())
  normalizedName String   @unique
  canonicalScope String
  timesConfirmed Int      @default(1)
  createdBy      String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

- [ ] **Step 3: Validate (with `DATABASE_URL` set) and generate the migration offline**

```bash
npx prisma validate
TS=$(date -u +%Y%m%d%H%M%S); DIR="prisma/migrations/${TS}_add_scope_dictionary"; mkdir -p "$DIR"; npx prisma migrate diff --from-schema-datamodel /tmp/schema-prev.prisma --to-schema-datamodel prisma/schema.prisma --script > "$DIR/migration.sql"; cat "$DIR/migration.sql"
```

Expected: one `CREATE TABLE "ScopeDictionaryEntry"` + a unique index on `normalizedName`. No changes to existing tables.

- [ ] **Step 4: Regenerate the client and apply the migration**

```bash
npx prisma generate
npx prisma migrate deploy   # requires DATABASE_URL; applies the new table
```

Expected: `Generated Prisma Client`; migration `…_add_scope_dictionary` applied.

- [ ] **Step 5: Commit (schema + migration together)**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add ScopeDictionaryEntry global normalization table"
```

(The DB round-trip is exercised by Task 4's service tests.)

---

## Task 2: normalizeName (pure)

**Files:**
- Create: `lib/normalize/normalizeName.ts`
- Test: `tests/normalize/normalizeName.test.ts`

**Interfaces:**
- Produces: `normalizeName(name: string): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/normalize/normalizeName.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeName } from "@/lib/normalize/normalizeName";

describe("normalizeName", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeName("  Electrical   Rough-In  ")).toBe("electrical rough-in");
  });
  it("is idempotent", () => {
    const once = normalizeName("MEP  Rough");
    expect(normalizeName(once)).toBe(once);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/normalize/normalizeName.test.ts`
Expected: FAIL — `Cannot find module '@/lib/normalize/normalizeName'`.

- [ ] **Step 3: Implement**

Create `lib/normalize/normalizeName.ts`:

```ts
/** Exact-match key for the scope dictionary: lowercase, trim, collapse whitespace. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/normalize/normalizeName.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/normalize/normalizeName.ts tests/normalize/normalizeName.test.ts
git commit -m "feat(normalize): name normalization key"
```

---

## Task 3: suggestScopes (pure)

**Files:**
- Create: `lib/normalize/suggestScopes.ts`
- Test: `tests/normalize/suggestScopes.test.ts`

**Interfaces:**
- Consumes: `normalizeName` from `@/lib/normalize/normalizeName`.
- Produces: `suggestScopes(rawName: string, knownScopes: string[], limit?: number): string[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/normalize/suggestScopes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { suggestScopes } from "@/lib/normalize/suggestScopes";

describe("suggestScopes", () => {
  it("ranks higher token overlap first and drops zero-overlap scopes", () => {
    const out = suggestScopes("Electrical Rough In", ["Electrical Rough In", "Electrical", "Concrete Slab"]);
    expect(out[0]).toBe("Electrical Rough In");
    expect(out).toContain("Electrical");
    expect(out).not.toContain("Concrete Slab");
  });
  it("respects the limit", () => {
    const out = suggestScopes("rough in work", ["rough in a", "rough in b", "rough in c"], 2);
    expect(out.length).toBe(2);
  });
  it("returns empty for no known scopes", () => {
    expect(suggestScopes("anything", [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/normalize/suggestScopes.test.ts`
Expected: FAIL — `Cannot find module '@/lib/normalize/suggestScopes'`.

- [ ] **Step 3: Implement**

Create `lib/normalize/suggestScopes.ts`:

```ts
import { normalizeName } from "@/lib/normalize/normalizeName";

function tokens(s: string): Set<string> {
  return new Set(normalizeName(s).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Rank known scopes by token overlap with the raw name; suggestions only (no auto-apply). */
export function suggestScopes(rawName: string, knownScopes: string[], limit = 5): string[] {
  const rt = tokens(rawName);
  return knownScopes
    .map((s) => ({ s, score: jaccard(rt, tokens(s)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.length - b.s.length)
    .slice(0, limit)
    .map((x) => x.s);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/normalize/suggestScopes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/normalize/suggestScopes.ts tests/normalize/suggestScopes.test.ts
git commit -m "feat(normalize): fuzzy scope suggestions by token overlap"
```

---

## Task 4: Normalization service

**Files:**
- Create: `lib/normalize/normalizationService.ts`
- Test: `tests/normalize/normalizationService.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`; `normalizeName` from `@/lib/normalize/normalizeName`.
- Produces:
  - interface `ActivityName = { name: string }`
  - interface `ApplyResult<A> = { mapped: { activity: A; canonicalScope: string }[]; unmappedNames: string[] }`
  - `applyDictionaryWith<A extends ActivityName>(activities: A[], dict: Map<string,string>): ApplyResult<A>` (pure)
  - `getDictionary(): Promise<Map<string,string>>`
  - `applyDictionary<A extends ActivityName>(activities: A[]): Promise<ApplyResult<A>>`
  - `getKnownScopes(): Promise<string[]>`
  - `confirmMapping(rawName: string, canonicalScope: string): Promise<void>`

- [ ] **Step 1: Write the tests (one pure, rest DB-gated)**

Create `tests/normalize/normalizationService.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyDictionaryWith, confirmMapping, getDictionary, getKnownScopes, applyDictionary } from "@/lib/normalize/normalizationService";

describe("applyDictionaryWith (pure)", () => {
  it("splits mapped vs distinct unmapped names", () => {
    const dict = new Map([["electrical rough-in", "Electrical Rough-In"]]);
    const res = applyDictionaryWith(
      [{ name: "Electrical Rough-In" }, { name: "Electrical Rough-In" }, { name: "Mystery Task" }, { name: "Mystery Task" }],
      dict,
    );
    expect(res.mapped.length).toBe(2);
    expect(res.mapped[0].canonicalScope).toBe("Electrical Rough-In");
    expect(res.unmappedNames).toEqual(["Mystery Task"]); // deduped
  });
});

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("normalizationService (db)", () => {
  const made: string[] = [];
  afterAll(async () => {
    if (made.length) await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: { in: made } } });
    await prisma.$disconnect();
  });

  it("confirms, auto-maps exactly, learns across projects, and corrects", async () => {
    const raw = `ZZ Test Scope ${Date.now()}`;
    made.push(raw.trim().toLowerCase().replace(/\s+/g, " "));

    await confirmMapping(raw, "Test Scope A");
    const dict = await getDictionary();
    expect(dict.get(raw.trim().toLowerCase())).toBe("Test Scope A");

    // exact auto-map applies regardless of which project the activity is on
    const res = await applyDictionary([{ name: raw }, { name: `${raw} unseen` }]);
    expect(res.mapped.length).toBe(1);
    expect(res.unmappedNames).toEqual([`${raw} unseen`]);

    // known scopes includes the confirmed scope
    expect(await getKnownScopes()).toContain("Test Scope A");

    // correction updates the scope and bumps timesConfirmed
    await confirmMapping(raw, "Test Scope B");
    const entry = await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: raw.trim().toLowerCase() } });
    expect(entry?.canonicalScope).toBe("Test Scope B");
    expect(entry?.timesConfirmed).toBe(2);
  }, 30000);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/normalize/normalizationService.test.ts`
Expected: FAIL — `Cannot find module '@/lib/normalize/normalizationService'`.

- [ ] **Step 3: Implement**

Create `lib/normalize/normalizationService.ts`:

```ts
import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/normalize/normalizeName";

export interface ActivityName {
  name: string;
}

export interface ApplyResult<A> {
  mapped: { activity: A; canonicalScope: string }[];
  unmappedNames: string[];
}

export function applyDictionaryWith<A extends ActivityName>(activities: A[], dict: Map<string, string>): ApplyResult<A> {
  const mapped: { activity: A; canonicalScope: string }[] = [];
  const unmapped = new Set<string>();
  for (const a of activities) {
    const scope = dict.get(normalizeName(a.name));
    if (scope) mapped.push({ activity: a, canonicalScope: scope });
    else unmapped.add(a.name.trim());
  }
  return { mapped, unmappedNames: [...unmapped] };
}

export async function getDictionary(): Promise<Map<string, string>> {
  const rows = await prisma.scopeDictionaryEntry.findMany();
  return new Map(rows.map((r) => [r.normalizedName, r.canonicalScope]));
}

export async function applyDictionary<A extends ActivityName>(activities: A[]): Promise<ApplyResult<A>> {
  return applyDictionaryWith(activities, await getDictionary());
}

export async function getKnownScopes(): Promise<string[]> {
  const rows = await prisma.scopeDictionaryEntry.findMany({
    distinct: ["canonicalScope"],
    select: { canonicalScope: true },
    orderBy: { canonicalScope: "asc" },
  });
  return rows.map((r) => r.canonicalScope);
}

export async function confirmMapping(rawName: string, canonicalScope: string): Promise<void> {
  const normalizedName = normalizeName(rawName);
  const scope = canonicalScope.trim();
  if (!normalizedName || !scope) return;
  await prisma.scopeDictionaryEntry.upsert({
    where: { normalizedName },
    create: { normalizedName, canonicalScope: scope },
    update: { canonicalScope: scope, timesConfirmed: { increment: 1 } },
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- tests/normalize/normalizationService.test.ts`
Expected: PASS (pure test always; db block passes with `DATABASE_URL`).

- [ ] **Step 5: Commit**

```bash
git add lib/normalize/normalizationService.ts tests/normalize/normalizationService.test.ts
git commit -m "feat(normalize): dictionary apply, confirm/learn, and known-scopes"
```

---

## Task 5: Normalize API route

**Files:**
- Create: `app/api/normalize/route.ts`
- Test: extend `tests/normalize/normalizationService.test.ts` with a route test

**Interfaces:**
- Consumes: `confirmMapping` from `@/lib/normalize/normalizationService`.
- Produces: `POST(req)` — body `{ mappings: { rawName, canonicalScope }[] }` → `{ ok: true }` or `{ error }` 422.

- [ ] **Step 1: Add the failing route test**

Append inside the `describe.runIf(hasDb)` block in `tests/normalize/normalizationService.test.ts`:

```ts
  it("route persists posted mappings", async () => {
    const { POST } = await import("@/app/api/normalize/route");
    const raw = `ZZ Route Scope ${Date.now()}`;
    made.push(raw.trim().toLowerCase().replace(/\s+/g, " "));
    const req = new Request("http://localhost/api/normalize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings: [{ rawName: raw, canonicalScope: "Routed Scope" }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const dict = await getDictionary();
    expect(dict.get(raw.trim().toLowerCase())).toBe("Routed Scope");
  }, 30000);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- tests/normalize/normalizationService.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/normalize/route'`.

- [ ] **Step 3: Implement**

Create `app/api/normalize/route.ts`:

```ts
import { NextResponse } from "next/server";
import { confirmMapping } from "@/lib/normalize/normalizationService";

export async function POST(req: Request) {
  const body = (await req.json()) as { mappings?: { rawName: string; canonicalScope: string }[] };
  if (!Array.isArray(body.mappings)) {
    return NextResponse.json({ error: { message: "mappings array required." } }, { status: 422 });
  }
  try {
    for (const m of body.mappings) {
      if (m?.rawName && m?.canonicalScope) await confirmMapping(m.rawName, m.canonicalScope);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- tests/normalize/normalizationService.test.ts`
Expected: PASS with `DATABASE_URL` set.

- [ ] **Step 5: Commit**

```bash
git add app/api/normalize/route.ts tests/normalize/normalizationService.test.ts
git commit -m "feat(normalize): API route to persist confirmed mappings"
```

---

## Task 6: Normalize page, panel, and nav link

**Files:**
- Create: `components/NormalizePanel.tsx`
- Create: `app/projects/[id]/normalize/page.tsx`
- Modify: `app/projects/[id]/page.tsx` (add nav button)

**Interfaces:**
- Consumes: `applyDictionary`, `getKnownScopes` from `@/lib/normalize/normalizationService`; `suggestScopes` from `@/lib/normalize/suggestScopes`. Posts to `POST /api/normalize`.
- Produces: `NormalizePanel` + exported type `UnmappedRow`.

- [ ] **Step 1: Implement the client panel**

Create `components/NormalizePanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface UnmappedRow {
  rawName: string;
  count: number;
  suggestions: string[];
}

export function NormalizePanel({ projectId, rows, knownScopes }: { projectId: string; rows: UnmappedRow[]; knownScopes: string[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(rawName: string, scope: string) {
    setValues((v) => ({ ...v, [rawName]: scope }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    const mappings = Object.entries(values)
      .filter(([, s]) => s.trim())
      .map(([rawName, canonicalScope]) => ({ rawName, canonicalScope: canonicalScope.trim() }));
    const res = await fetch("/api/normalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Save failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <datalist id="known-scopes">
        {knownScopes.map((s) => <option key={s} value={s} />)}
      </datalist>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {rows.map((r) => (
          <li key={r.rawName} className="px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{r.rawName}</span>
              <span className="text-xs text-slate-400">{r.count} activit{r.count === 1 ? "y" : "ies"}</span>
            </div>
            {r.suggestions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {r.suggestions.map((s) => (
                  <button key={s} onClick={() => set(r.rawName, s)} className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">{s}</button>
                ))}
              </div>
            )}
            <input
              list="known-scopes"
              value={values[r.rawName] ?? ""}
              onChange={(e) => set(r.rawName, e.target.value)}
              placeholder="Standard scope"
              className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </li>
        ))}
      </ul>
      <button disabled={busy} onClick={save} className="mt-4 rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Saving…" : "Save mappings"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Implement the normalize page**

Create `app/projects/[id]/normalize/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { applyDictionary, getKnownScopes } from "@/lib/normalize/normalizationService";
import { suggestScopes } from "@/lib/normalize/suggestScopes";
import { NormalizePanel, type UnmappedRow } from "@/components/NormalizePanel";

export const dynamic = "force-dynamic";

export default async function NormalizePage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId: project.id },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  const leaves = (latest?.activities ?? []).filter((a) => a.type !== "summary" && a.type !== "project_summary");
  const { mapped, unmappedNames } = await applyDictionary(leaves);
  const knownScopes = await getKnownScopes();

  const counts = new Map<string, number>();
  for (const a of leaves) {
    const key = a.name.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const rows: UnmappedRow[] = unmappedNames.map((name) => ({
    rawName: name,
    count: counts.get(name) ?? 1,
    suggestions: suggestScopes(name, knownScopes),
  }));

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Normalize scopes</h1>
      <p className="mb-4 text-sm text-slate-500">{mapped.length} activities already mapped · {rows.length} names to review</p>
      {!latest ? (
        <p className="text-slate-500">Import a schedule first.</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">All activity names are mapped.</p>
      ) : (
        <NormalizePanel projectId={project.id} rows={rows} knownScopes={knownScopes} />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Add the nav button to the project page**

In `app/projects/[id]/page.tsx`, add a Normalize link into the existing button cluster (after the Export link):

```tsx
          <Link href={`/projects/${project.id}/normalize`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Normalize scopes
          </Link>
```

- [ ] **Step 4: Full test + build gate**

Run: `npm run test && npm run build`
Expected: tests PASS (unit always; DB-gated pass with `DATABASE_URL`); BUILD exit 0 with route `/projects/[id]/normalize` present.

- [ ] **Step 5: Commit**

```bash
git add components/NormalizePanel.tsx "app/projects/[id]/normalize/page.tsx" "app/projects/[id]/page.tsx"
git commit -m "feat(normalize): review screen, panel, and nav link"
```

---

## Manual Smoke Test (after Task 6)

1. Open a project with an imported schedule → **Normalize scopes**.
2. Confirm a few distinct unmapped names (use a suggestion chip or type a scope) → **Save**.
3. Re-open: those names now count toward "already mapped".
4. Import (or open) another project sharing one of those names → it auto-maps there too (global learning).

---

## Self-Review

- **Spec coverage:** §4 table → Task 1. §5.1 `normalizeName` → Task 2. §5.2 `suggestScopes` → Task 3. §6 service (getDictionary/applyDictionary/confirmMapping/getKnownScopes) → Task 4. §7 routes/flow/components → Tasks 5, 6. §8 telemetry → opt-out, no code. §9 testing tiers → unit (2,3, pure part of 4), DB-gated (4,5), build/smoke (6). Non-goals respected: no AI, no snapshot mutation, no taxonomy table, fuzzy never auto-applies.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `ActivityName`/`ApplyResult` defined in Task 4 and used by its consumers; `applyDictionaryWith` (pure) vs `applyDictionary` (DB) distinct; `UnmappedRow` defined in Task 6 panel and consumed by its page; `suggestScopes(rawName, knownScopes, limit?)` signature consistent Tasks 3 & 6; `confirmMapping(rawName, canonicalScope)` consistent Tasks 4 & 5.
```
