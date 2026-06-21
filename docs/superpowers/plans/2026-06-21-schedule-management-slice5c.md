# Schedule Management — Slice 5c (Completeness / Granularity Check) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a scheduler mark a canonical scope as "coarse" with a finer breakdown, and surface a read-only Completeness page flagging every activity in the latest import mapped to a coarse scope, with per-activity dismiss.

**Architecture:** Two new Postgres tables (`ScopeSplitRule`, global; `CompletenessDismissal`, project-scoped). A pure check function (`checkCompleteness`) mirrors the existing `lib/health/dateChecks.ts` pattern: no DB, fully unit-testable. A DB service (`completenessService.ts`) loads the latest import, reuses 5a's `applyDictionary` to resolve scopes, runs the pure check, and filters dismissed issues. UI extends the existing Normalize page with a new panel and adds a new Completeness page, both following the established server-page + client-panel + flat API-route pattern.

**Tech Stack:** Next.js 14 (App Router), Prisma + PostgreSQL, Tailwind, Vitest. Same stack as Slices 1–5b — no new dependencies.

## Global Constraints

- TypeScript strict mode — no `any`. (Project CLAUDE.md / global CLAUDE.md.)
- No `console.log` in server code — none of this slice's code needs logging.
- No dead code — no unused exports/variables.
- Deterministic, no AI/LLM (`CLAUDE.md` "Don't Build Yet").
- Imports are immutable — this slice never writes to `Activity`/`ScheduleImport`; only the two new tables are written.
- TDD per task, commit per task (`docs/SLICE5_HANDOFF.md` convention). Build directly on `master`, no feature branches.
- Migrations: schema change + generated migration file committed together in one commit (root `CLAUDE.md` Git section).
- DB-gated tests run only when `DATABASE_URL` is set; they must self-clean (delete what they create) and use a 30000ms timeout for multi-round-trip tests.
- Gate every commit on `npm run test && npm run build` passing.

---

### Task 1: Schema migration — `ScopeSplitRule` and `CompletenessDismissal`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260621000001_add_completeness/migration.sql`

**Interfaces:**
- Produces: Prisma models `ScopeSplitRule { id, coarseScope, finerScope, createdBy, createdAt, updatedAt }` and `CompletenessDismissal { id, projectId, canonicalActivityKey, coarseScope, dismissedBy, note, createdAt }`, both available via `prisma.scopeSplitRule` / `prisma.completenessDismissal` after `prisma generate`.

This project has no live local `DATABASE_URL`, so migrations are generated offline (per `docs/SLICE5_HANDOFF.md` "Migrations (offline diff)" convention) rather than via `prisma migrate dev`.

- [ ] **Step 1: Snapshot the current schema for diffing**

```bash
cp prisma/schema.prisma /tmp/schema-prev.prisma
```

- [ ] **Step 2: Add the two new models to `prisma/schema.prisma`**

Add a new relation field to the existing `Project` model — insert `completenessDismissals ProjectTradeAssignment[]` is wrong, use this exact line right after `tradeAssignments`:

```prisma
model Project {
  id                  String   @id @default(cuid())
  name                String
  client              String?
  sector              String?
  buildingType        String?
  sizeSqFt            Int?
  contractValue       Decimal? @db.Decimal(14, 2)
  region              String?
  deliveryMethod      String?
  status              String   @default("active")
  externalProjectKey  String?
  externalProjectGuid String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  imports             ScheduleImport[]
  progressUpdates     ProgressUpdate[]
  tradeAssignments    ProjectTradeAssignment[]
  completenessDismissals CompletenessDismissal[]
}
```

Then append two new models at the end of the file (after `ProjectTradeAssignment`):

```prisma
model ScopeSplitRule {
  id          String   @id @default(cuid())
  coarseScope String
  finerScope  String
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
  canonicalActivityKey String
  coarseScope          String
  dismissedBy          String?
  note                 String?
  createdAt            DateTime @default(now())

  @@unique([projectId, canonicalActivityKey, coarseScope])
  @@index([projectId])
}
```

- [ ] **Step 3: Generate the migration SQL via offline diff**

```bash
DATABASE_URL="postgresql://u:p@localhost:5432/db" npx prisma migrate diff --from-schema-datamodel /tmp/schema-prev.prisma --to-schema-datamodel prisma/schema.prisma --script
```

The `DATABASE_URL` value here is a placeholder only — `migrate diff --from-schema-datamodel`/`--to-schema-datamodel` never connects to a database, it just needs the env var to be non-empty for Prisma to parse the datasource block.

Expected output (verified during planning):

```sql
-- CreateTable
CREATE TABLE "ScopeSplitRule" (
    "id" TEXT NOT NULL,
    "coarseScope" TEXT NOT NULL,
    "finerScope" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeSplitRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompletenessDismissal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "canonicalActivityKey" TEXT NOT NULL,
    "coarseScope" TEXT NOT NULL,
    "dismissedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletenessDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScopeSplitRule_coarseScope_idx" ON "ScopeSplitRule"("coarseScope");

-- CreateIndex
CREATE UNIQUE INDEX "ScopeSplitRule_coarseScope_finerScope_key" ON "ScopeSplitRule"("coarseScope", "finerScope");

-- CreateIndex
CREATE INDEX "CompletenessDismissal_projectId_idx" ON "CompletenessDismissal"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CompletenessDismissal_projectId_canonicalActivityKey_coarse_key" ON "CompletenessDismissal"("projectId", "canonicalActivityKey", "coarseScope");

-- AddForeignKey
ALTER TABLE "CompletenessDismissal" ADD CONSTRAINT "CompletenessDismissal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Write the migration file**

```bash
mkdir -p prisma/migrations/20260621000001_add_completeness
```

Save the exact SQL output from Step 3 into `prisma/migrations/20260621000001_add_completeness/migration.sql`.

- [ ] **Step 5: Regenerate the Prisma client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client` success message, no errors. This makes `prisma.scopeSplitRule` and `prisma.completenessDismissal` available to TypeScript.

- [ ] **Step 6: Verify the project still builds**

```bash
npm run build
```

Expected: build succeeds (this step only touches schema/generated client, no application code yet).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260621000001_add_completeness
git commit -m "feat(db): add ScopeSplitRule and CompletenessDismissal tables"
```

---

### Task 2: `splitRuleService` — manage split rules

**Files:**
- Create: `lib/completeness/splitRuleService.ts`
- Test: `tests/completeness/splitRuleService.test.ts`

**Interfaces:**
- Consumes: `prisma.scopeSplitRule` (Task 1).
- Produces:
  - `getSplitRules(): Promise<Map<string, string[]>>` — `coarseScope → finerScope[]`, sorted ascending within each list.
  - `addSplitRule(coarseScope: string, finerScope: string, createdBy?: string): Promise<void>`
  - `removeSplitRule(coarseScope: string, finerScope: string): Promise<void>`

- [ ] **Step 1: Write the failing DB-gated tests**

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getSplitRules, addSplitRule, removeSplitRule } from "@/lib/completeness/splitRuleService";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("splitRuleService", () => {
  const coarse = `ZZ Test Coarse ${Date.now()}`;

  afterAll(async () => {
    await prisma.scopeSplitRule.deleteMany({ where: { coarseScope: coarse } });
    await prisma.$disconnect();
  });

  it("adds rules, lists them, and removes one", async () => {
    await addSplitRule(coarse, "Finer B");
    await addSplitRule(coarse, "Finer A");

    const rules = await getSplitRules();
    expect(rules.get(coarse)).toEqual(["Finer A", "Finer B"]);

    await removeSplitRule(coarse, "Finer B");
    const after = await getSplitRules();
    expect(after.get(coarse)).toEqual(["Finer A"]);
  }, 30000);

  it("ignores blank input", async () => {
    await addSplitRule("  ", "  ");
    const rules = await getSplitRules();
    expect(rules.has("")).toBe(false);
  }, 15000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/completeness/splitRuleService.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/completeness/splitRuleService'`. (If `DATABASE_URL` is not set in this environment, the suite will report 0 tests run / skipped — that's expected; the test still must be written correctly for whoever runs it against the Railway public DB per the handoff convention.)

- [ ] **Step 3: Implement the service**

```typescript
import { prisma } from "@/lib/db";

export async function getSplitRules(): Promise<Map<string, string[]>> {
  const rows = await prisma.scopeSplitRule.findMany({ orderBy: [{ coarseScope: "asc" }, { finerScope: "asc" }] });
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const list = map.get(r.coarseScope) ?? [];
    list.push(r.finerScope);
    map.set(r.coarseScope, list);
  }
  return map;
}

export async function addSplitRule(coarseScope: string, finerScope: string, createdBy?: string): Promise<void> {
  const coarse = coarseScope.trim();
  const finer = finerScope.trim();
  if (!coarse || !finer) return;
  await prisma.scopeSplitRule.upsert({
    where: { coarseScope_finerScope: { coarseScope: coarse, finerScope: finer } },
    create: { coarseScope: coarse, finerScope: finer, createdBy },
    update: {},
  });
}

export async function removeSplitRule(coarseScope: string, finerScope: string): Promise<void> {
  await prisma.scopeSplitRule.deleteMany({
    where: { coarseScope: coarseScope.trim(), finerScope: finerScope.trim() },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/completeness/splitRuleService.test.ts
```

Expected: PASS (or skipped if no `DATABASE_URL` — confirm via `npm test` output showing the file listed under skipped, not erroring).

- [ ] **Step 5: Run the full build to catch type errors**

```bash
npm run build
```

Expected: success.

- [ ] **Step 6: Commit**

```bash
git add lib/completeness/splitRuleService.ts tests/completeness/splitRuleService.test.ts
git commit -m "feat(completeness): split-rule dictionary CRUD"
```

---

### Task 3: `/api/completeness/split-rules` route

**Files:**
- Create: `app/api/completeness/split-rules/route.ts`
- Test: append to `tests/completeness/splitRuleService.test.ts`

**Interfaces:**
- Consumes: `addSplitRule`, `removeSplitRule` (Task 2).
- Produces: `POST /api/completeness/split-rules` body `{ coarseScope, finerScope }` → `{ ok: true }` / `{ error }` 422. `DELETE` same body shape, same response shape.

- [ ] **Step 1: Write the failing route test**

Append to `tests/completeness/splitRuleService.test.ts` (inside the existing `describe.runIf(hasDb)("splitRuleService", ...)` block, as a new `it`):

```typescript
  it("route adds and removes a rule", async () => {
    const { POST, DELETE } = await import("@/app/api/completeness/split-rules/route");
    const body = JSON.stringify({ coarseScope: coarse, finerScope: "Route Finer" });

    const postRes = await POST(new Request("http://localhost/api/completeness/split-rules", {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    }));
    expect(postRes.status).toBe(200);
    expect((await getSplitRules()).get(coarse)).toContain("Route Finer");

    const delRes = await DELETE(new Request("http://localhost/api/completeness/split-rules", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body,
    }));
    expect(delRes.status).toBe(200);
    expect((await getSplitRules()).get(coarse) ?? []).not.toContain("Route Finer");
  }, 30000);

  it("route rejects a missing coarseScope", async () => {
    const { POST } = await import("@/app/api/completeness/split-rules/route");
    const res = await POST(new Request("http://localhost/api/completeness/split-rules", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ finerScope: "x" }),
    }));
    expect(res.status).toBe(422);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/completeness/splitRuleService.test.ts
```

Expected: FAIL — `Cannot find module '@/app/api/completeness/split-rules/route'`.

- [ ] **Step 3: Implement the route**

```typescript
import { NextResponse } from "next/server";
import { addSplitRule, removeSplitRule } from "@/lib/completeness/splitRuleService";

interface SplitRuleBody {
  coarseScope?: string;
  finerScope?: string;
}

function validate(body: SplitRuleBody): string | null {
  if (!body.coarseScope?.trim() || !body.finerScope?.trim()) return "coarseScope and finerScope are required.";
  return null;
}

export async function POST(req: Request) {
  const body = (await req.json()) as SplitRuleBody;
  const err = validate(body);
  if (err) return NextResponse.json({ error: { message: err } }, { status: 422 });
  try {
    await addSplitRule(body.coarseScope!, body.finerScope!);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}

export async function DELETE(req: Request) {
  const body = (await req.json()) as SplitRuleBody;
  const err = validate(body);
  if (err) return NextResponse.json({ error: { message: err } }, { status: 422 });
  try {
    await removeSplitRule(body.coarseScope!, body.finerScope!);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to remove.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/completeness/splitRuleService.test.ts
```

Expected: PASS (or skipped without `DATABASE_URL`).

- [ ] **Step 5: Commit**

```bash
git add app/api/completeness/split-rules/route.ts tests/completeness/splitRuleService.test.ts
git commit -m "feat(completeness): API route to add/remove split rules"
```

---

### Task 4: Pure completeness checks

**Files:**
- Create: `lib/completeness/completenessChecks.ts`
- Test: `tests/completeness/completenessChecks.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface CompletenessActivity { canonicalActivityKey: string; externalId: number | null; wbsCode: string | null; name: string; canonicalScope: string | null }`
  - `interface CompletenessIssue { canonicalActivityKey: string; externalId: number | null; wbsCode: string | null; name: string; coarseScope: string; finerScopes: string[] }`
  - `checkCompleteness(activities: CompletenessActivity[], splitRules: Map<string, string[]>): CompletenessIssue[]`
  - `summarizeCompleteness(issues: CompletenessIssue[]): { total: number; byCoarseScope: { coarseScope: string; count: number }[] }`

- [ ] **Step 1: Write the failing unit tests**

```typescript
import { describe, it, expect } from "vitest";
import { checkCompleteness, summarizeCompleteness, type CompletenessActivity } from "@/lib/completeness/completenessChecks";

function act(overrides: Partial<CompletenessActivity> = {}): CompletenessActivity {
  return {
    canonicalActivityKey: "1|task",
    externalId: 1,
    wbsCode: "1",
    name: "MEP Rough",
    canonicalScope: "MEP Rough",
    ...overrides,
  };
}

describe("checkCompleteness", () => {
  it("flags an activity whose scope has a split rule", () => {
    const rules = new Map([["MEP Rough", ["Electrical Rough-In", "Mechanical Rough-In", "Plumbing Rough-In"]]]);
    const issues = checkCompleteness([act()], rules);
    expect(issues).toHaveLength(1);
    expect(issues[0].coarseScope).toBe("MEP Rough");
    expect(issues[0].finerScopes).toEqual(["Electrical Rough-In", "Mechanical Rough-In", "Plumbing Rough-In"]);
  });

  it("does not flag a scope with no split rule", () => {
    const rules = new Map([["Other Scope", ["A", "B"]]]);
    expect(checkCompleteness([act()], rules)).toEqual([]);
  });

  it("does not flag an activity with no mapped scope", () => {
    const rules = new Map([["MEP Rough", ["A", "B"]]]);
    expect(checkCompleteness([act({ canonicalScope: null })], rules)).toEqual([]);
  });

  it("returns nothing for empty split rules", () => {
    expect(checkCompleteness([act()], new Map())).toEqual([]);
  });
});

describe("summarizeCompleteness", () => {
  it("counts issues by coarse scope", () => {
    const issues = checkCompleteness(
      [act({ canonicalActivityKey: "1|a" }), act({ canonicalActivityKey: "2|a" }), act({ canonicalActivityKey: "3|a", canonicalScope: "Other" })],
      new Map([["MEP Rough", ["A", "B"]], ["Other", ["C", "D"]]]),
    );
    const summary = summarizeCompleteness(issues);
    expect(summary.total).toBe(3);
    expect(summary.byCoarseScope).toEqual(
      expect.arrayContaining([{ coarseScope: "MEP Rough", count: 2 }, { coarseScope: "Other", count: 1 }]),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/completeness/completenessChecks.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/completeness/completenessChecks'`.

- [ ] **Step 3: Implement the pure checks**

```typescript
// Pure, deterministic granularity check: flags activities whose normalized
// scope (from the 5a dictionary) has been marked "coarse" via a split rule.
// No DB, no AI. Computed entirely at read time.

export interface CompletenessActivity {
  canonicalActivityKey: string;
  externalId: number | null;
  wbsCode: string | null;
  name: string;
  canonicalScope: string | null;
}

export interface CompletenessIssue {
  canonicalActivityKey: string;
  externalId: number | null;
  wbsCode: string | null;
  name: string;
  coarseScope: string;
  finerScopes: string[];
}

export interface CompletenessSummary {
  total: number;
  byCoarseScope: { coarseScope: string; count: number }[];
}

export function checkCompleteness(activities: CompletenessActivity[], splitRules: Map<string, string[]>): CompletenessIssue[] {
  const issues: CompletenessIssue[] = [];
  for (const a of activities) {
    if (!a.canonicalScope) continue;
    const finerScopes = splitRules.get(a.canonicalScope);
    if (!finerScopes || finerScopes.length === 0) continue;
    issues.push({
      canonicalActivityKey: a.canonicalActivityKey,
      externalId: a.externalId,
      wbsCode: a.wbsCode,
      name: a.name,
      coarseScope: a.canonicalScope,
      finerScopes,
    });
  }
  issues.sort((x, y) => (x.wbsCode ?? "").localeCompare(y.wbsCode ?? "", undefined, { numeric: true }));
  return issues;
}

export function summarizeCompleteness(issues: CompletenessIssue[]): CompletenessSummary {
  const counts = new Map<string, number>();
  for (const i of issues) counts.set(i.coarseScope, (counts.get(i.coarseScope) ?? 0) + 1);
  return {
    total: issues.length,
    byCoarseScope: [...counts.entries()].map(([coarseScope, count]) => ({ coarseScope, count })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/completeness/completenessChecks.test.ts
```

Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/completeness/completenessChecks.ts tests/completeness/completenessChecks.test.ts
git commit -m "feat(completeness): pure granularity check over split rules"
```

---

### Task 5: `completenessService` — load latest import, resolve scopes, filter dismissals

**Files:**
- Create: `lib/completeness/completenessService.ts`
- Test: `tests/completeness/completenessService.test.ts`

**Interfaces:**
- Consumes: `prisma` (`lib/db.ts`), `applyDictionary` (`lib/normalize/normalizationService.ts`, Task: existing 5a), `getSplitRules` (Task 2), `checkCompleteness`, `summarizeCompleteness` (Task 4).
- Produces:
  - `interface ScheduleCompleteness { hasImport: boolean; issues: CompletenessIssue[]; summary: CompletenessSummary }`
  - `getCompleteness(projectId: string): Promise<ScheduleCompleteness>`
  - `dismissIssue(projectId: string, canonicalActivityKey: string, coarseScope: string, dismissedBy?: string, note?: string): Promise<void>`

- [ ] **Step 1: Write the failing DB-gated tests**

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getCompleteness, dismissIssue } from "@/lib/completeness/completenessService";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("completenessService", () => {
  let projectId = "";
  let projectId2 = "";
  const coarse = `ZZ Coarse ${Date.now()}`;

  afterAll(async () => {
    await prisma.scopeSplitRule.deleteMany({ where: { coarseScope: coarse } });
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    if (projectId2) await prisma.project.delete({ where: { id: projectId2 } });
    await prisma.$disconnect();
  });

  async function makeProjectWithActivity(name: string, activityName: string) {
    const project = await prisma.project.create({ data: { name } });
    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: `h-${project.id}` },
    });
    await prisma.activity.create({
      data: {
        scheduleImportId: imp.id,
        externalUid: 1,
        externalId: 1,
        wbsCode: "1",
        name: activityName,
        canonicalActivityKey: `1|${activityName.toLowerCase()}`,
        type: "task",
      },
    });
    return project.id;
  }

  it("flags an activity mapped to a coarse scope, then hides it once dismissed", async () => {
    await prisma.scopeSplitRule.create({ data: { coarseScope: coarse, finerScope: "Finer A" } });
    await prisma.scopeDictionaryEntry.upsert({
      where: { normalizedName: coarse.toLowerCase() },
      create: { normalizedName: coarse.toLowerCase(), canonicalScope: coarse },
      update: { canonicalScope: coarse },
    });

    projectId = await makeProjectWithActivity("Completeness Test", coarse);

    const before = await getCompleteness(projectId);
    expect(before.hasImport).toBe(true);
    expect(before.issues).toHaveLength(1);
    expect(before.issues[0].coarseScope).toBe(coarse);

    await dismissIssue(projectId, before.issues[0].canonicalActivityKey, coarse);
    const after = await getCompleteness(projectId);
    expect(after.issues).toHaveLength(0);

    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: coarse.toLowerCase() } });
  }, 30000);

  it("scopes dismissal per project", async () => {
    await prisma.scopeSplitRule.upsert({
      where: { coarseScope_finerScope: { coarseScope: coarse, finerScope: "Finer A" } },
      create: { coarseScope: coarse, finerScope: "Finer A" },
      update: {},
    });
    await prisma.scopeDictionaryEntry.upsert({
      where: { normalizedName: coarse.toLowerCase() },
      create: { normalizedName: coarse.toLowerCase(), canonicalScope: coarse },
      update: { canonicalScope: coarse },
    });

    projectId2 = await makeProjectWithActivity("Completeness Test 2", coarse);
    const result = await getCompleteness(projectId2);
    expect(result.issues).toHaveLength(1);

    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: coarse.toLowerCase() } });
  }, 30000);

  it("reports no import for a project without one", async () => {
    const p = await prisma.project.create({ data: { name: "Completeness No Import Test" } });
    const result = await getCompleteness(p.id);
    expect(result.hasImport).toBe(false);
    expect(result.issues).toEqual([]);
    await prisma.project.delete({ where: { id: p.id } });
  }, 15000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/completeness/completenessService.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/completeness/completenessService'`.

- [ ] **Step 3: Implement the service**

```typescript
import { prisma } from "@/lib/db";
import { applyDictionary } from "@/lib/normalize/normalizationService";
import { getSplitRules } from "@/lib/completeness/splitRuleService";
import { checkCompleteness, summarizeCompleteness, type CompletenessIssue, type CompletenessSummary } from "@/lib/completeness/completenessChecks";

export interface ScheduleCompleteness {
  hasImport: boolean;
  issues: CompletenessIssue[];
  summary: CompletenessSummary;
}

function isLeaf(type: string): boolean {
  return type !== "summary" && type !== "project_summary";
}

/**
 * Read-time granularity check for a project's latest import. Resolves each
 * leaf activity's normalized scope via the 5a dictionary, flags any mapped to
 * a scope with a split rule, then filters out anything already dismissed for
 * this project. Never mutates the immutable import snapshot.
 */
export async function getCompleteness(projectId: string): Promise<ScheduleCompleteness> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  if (!latest) {
    return { hasImport: false, issues: [], summary: summarizeCompleteness([]) };
  }

  const leaves = latest.activities.filter((a) => isLeaf(a.type) && a.isActive);
  const { mapped } = await applyDictionary(leaves);
  const splitRules = await getSplitRules();

  const candidates = mapped.map(({ activity, canonicalScope }) => ({
    canonicalActivityKey: activity.canonicalActivityKey,
    externalId: activity.externalId,
    wbsCode: activity.wbsCode,
    name: activity.name,
    canonicalScope,
  }));
  const allIssues = checkCompleteness(candidates, splitRules);

  const dismissals = await prisma.completenessDismissal.findMany({ where: { projectId } });
  const dismissed = new Set(dismissals.map((d) => `${d.canonicalActivityKey}::${d.coarseScope}`));
  const issues = allIssues.filter((i) => !dismissed.has(`${i.canonicalActivityKey}::${i.coarseScope}`));

  return { hasImport: true, issues, summary: summarizeCompleteness(issues) };
}

export async function dismissIssue(
  projectId: string,
  canonicalActivityKey: string,
  coarseScope: string,
  dismissedBy?: string,
  note?: string,
): Promise<void> {
  await prisma.completenessDismissal.upsert({
    where: { projectId_canonicalActivityKey_coarseScope: { projectId, canonicalActivityKey, coarseScope } },
    create: { projectId, canonicalActivityKey, coarseScope, dismissedBy, note },
    update: { dismissedBy, note },
  });
}
```

`applyDictionary`'s generic parameter requires activities to have a `name: string` field — `latest.activities` (Prisma `Activity[]`) satisfies that already, matching how `app/projects/[id]/normalize/page.tsx` calls it directly on Prisma rows.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/completeness/completenessService.test.ts
```

Expected: PASS (or skipped without `DATABASE_URL`).

- [ ] **Step 5: Run the full suite and build**

```bash
npm test && npm run build
```

Expected: all tests pass/skip cleanly, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add lib/completeness/completenessService.ts tests/completeness/completenessService.test.ts
git commit -m "feat(completeness): getCompleteness service with dismissal filtering"
```

---

### Task 6: `/api/completeness/dismiss` route

**Files:**
- Create: `app/api/completeness/dismiss/route.ts`
- Test: append to `tests/completeness/completenessService.test.ts`

**Interfaces:**
- Consumes: `dismissIssue` (Task 5).
- Produces: `POST /api/completeness/dismiss` body `{ projectId, canonicalActivityKey, coarseScope, note? }` → `{ ok: true }` / `{ error }` 422.

- [ ] **Step 1: Write the failing route test**

Append to `tests/completeness/completenessService.test.ts`, inside the existing `describe.runIf(hasDb)` block:

```typescript
  it("route dismisses an issue", async () => {
    await prisma.scopeSplitRule.upsert({
      where: { coarseScope_finerScope: { coarseScope: coarse, finerScope: "Finer A" } },
      create: { coarseScope: coarse, finerScope: "Finer A" },
      update: {},
    });
    await prisma.scopeDictionaryEntry.upsert({
      where: { normalizedName: coarse.toLowerCase() },
      create: { normalizedName: coarse.toLowerCase(), canonicalScope: coarse },
      update: { canonicalScope: coarse },
    });
    const pid = await makeProjectWithActivity("Completeness Route Test", coarse);

    const before = await getCompleteness(pid);
    expect(before.issues).toHaveLength(1);

    const { POST } = await import("@/app/api/completeness/dismiss/route");
    const res = await POST(new Request("http://localhost/api/completeness/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: pid, canonicalActivityKey: before.issues[0].canonicalActivityKey, coarseScope: coarse }),
    }));
    expect(res.status).toBe(200);

    const after = await getCompleteness(pid);
    expect(after.issues).toHaveLength(0);

    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: coarse.toLowerCase() } });
    await prisma.project.delete({ where: { id: pid } });
  }, 30000);

  it("route rejects a missing projectId", async () => {
    const { POST } = await import("@/app/api/completeness/dismiss/route");
    const res = await POST(new Request("http://localhost/api/completeness/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canonicalActivityKey: "x", coarseScope: "y" }),
    }));
    expect(res.status).toBe(422);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tests/completeness/completenessService.test.ts
```

Expected: FAIL — `Cannot find module '@/app/api/completeness/dismiss/route'`.

- [ ] **Step 3: Implement the route**

```typescript
import { NextResponse } from "next/server";
import { dismissIssue } from "@/lib/completeness/completenessService";

interface DismissBody {
  projectId?: string;
  canonicalActivityKey?: string;
  coarseScope?: string;
  note?: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as DismissBody;
  if (!body.projectId || !body.canonicalActivityKey || !body.coarseScope) {
    return NextResponse.json({ error: { message: "projectId, canonicalActivityKey, and coarseScope are required." } }, { status: 422 });
  }
  try {
    await dismissIssue(body.projectId, body.canonicalActivityKey, body.coarseScope, undefined, body.note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to dismiss.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- tests/completeness/completenessService.test.ts
```

Expected: PASS (or skipped without `DATABASE_URL`).

- [ ] **Step 5: Commit**

```bash
git add app/api/completeness/dismiss/route.ts tests/completeness/completenessService.test.ts
git commit -m "feat(completeness): API route to dismiss a flagged activity"
```

---

### Task 7: `SplitRulesPanel` and extend the Normalize page

**Files:**
- Create: `components/SplitRulesPanel.tsx`
- Modify: `app/projects/[id]/normalize/page.tsx`

**Interfaces:**
- Consumes: `getSplitRules` (Task 2, called from the page); `POST`/`DELETE` `/api/completeness/split-rules` (Task 3, called from the panel via `fetch`).
- Produces: a `SplitRulesPanel({ rules, knownScopes }: { rules: { coarseScope: string; finerScopes: string[] }[]; knownScopes: string[] })` client component, rendered as a new section on the Normalize page.

- [ ] **Step 1: Implement the component**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SplitRuleRow {
  coarseScope: string;
  finerScopes: string[];
}

export function SplitRulesPanel({ rules, knownScopes }: { rules: SplitRuleRow[]; knownScopes: string[] }) {
  const router = useRouter();
  const [coarse, setCoarse] = useState("");
  const [finer, setFiner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE", coarseScope: string, finerScope: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/completeness/split-rules", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coarseScope, finerScope }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Save failed.");
      return;
    }
    router.refresh();
  }

  async function add() {
    if (!coarse.trim() || !finer.trim()) return;
    await call("POST", coarse, finer);
    setFiner("");
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Split rules</h2>
      <p className="mb-2 text-xs text-slate-500">
        Mark a standard scope as coarse and list the finer scopes it should really be tracked as.
      </p>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <datalist id="known-scopes-split">
        {knownScopes.map((s) => <option key={s} value={s} />)}
      </datalist>

      {rules.length === 0 ? (
        <p className="mb-3 text-sm text-slate-500">No split rules defined yet.</p>
      ) : (
        <ul className="mb-3 divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {rules.map((r) => (
            <li key={r.coarseScope} className="px-3 py-3">
              <div className="font-medium">{r.coarseScope}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.finerScopes.map((f) => (
                  <button
                    key={f}
                    disabled={busy}
                    onClick={() => call("DELETE", r.coarseScope, f)}
                    className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200"
                    title="Remove"
                  >
                    {f} ×
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          list="known-scopes-split"
          value={coarse}
          onChange={(e) => setCoarse(e.target.value)}
          placeholder="Coarse scope"
          className="min-w-[10rem] flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <input
          list="known-scopes-split"
          value={finer}
          onChange={(e) => setFiner(e.target.value)}
          placeholder="Finer scope"
          className="min-w-[10rem] flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <button disabled={busy} onClick={add} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          Add
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Extend the Normalize page to load and render split rules**

In `app/projects/[id]/normalize/page.tsx`, add the import and load call, then render the panel below the existing content:

```typescript
import { getSplitRules } from "@/lib/completeness/splitRuleService";
import { SplitRulesPanel, type SplitRuleRow } from "@/components/SplitRulesPanel";
```

Inside `NormalizePage`, after `const knownScopes = await getKnownScopes();`:

```typescript
  const splitRulesMap = await getSplitRules();
  const splitRules: SplitRuleRow[] = [...splitRulesMap.entries()].map(([coarseScope, finerScopes]) => ({ coarseScope, finerScopes }));
```

Replace the closing of the `<main>` block — change:

```tsx
      ) : (
        <NormalizePanel projectId={project.id} rows={rows} knownScopes={knownScopes} />
      )}
    </main>
```

to:

```tsx
      ) : (
        <NormalizePanel projectId={project.id} rows={rows} knownScopes={knownScopes} />
      )}
      <div className="mt-8">
        <SplitRulesPanel rules={splitRules} knownScopes={knownScopes} />
      </div>
    </main>
```

Note: `SplitRulesPanel` must render unconditionally (outside the `!latest`/`rows.length === 0` branches) since split rules exist independent of whether there's anything left to normalize.

- [ ] **Step 3: Build and manually verify**

```bash
npm run build
```

Expected: success, no type errors.

- [ ] **Step 4: Commit**

```bash
git add components/SplitRulesPanel.tsx app/projects/[id]/normalize/page.tsx
git commit -m "feat(completeness): split-rules panel on the Normalize page"
```

---

### Task 8: Completeness page and `CompletenessIssuesTable`

**Files:**
- Create: `components/CompletenessIssuesTable.tsx`
- Create: `app/projects/[id]/completeness/page.tsx`

**Interfaces:**
- Consumes: `getCompleteness` (Task 5); `POST /api/completeness/dismiss` (Task 6, via `fetch` from the table component).
- Produces: a page rendered at `/projects/[id]/completeness`.

- [ ] **Step 1: Implement the table component**

```tsx
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompletenessIssue } from "@/lib/completeness/completenessChecks";

export function CompletenessIssuesTable({ projectId, issues }: { projectId: string; issues: CompletenessIssue[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const coarseScopes = useMemo(() => [...new Set(issues.map((i) => i.coarseScope))].sort(), [issues]);

  const view = useMemo(() => {
    let r = issues;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      r = r.filter((i) => i.name.toLowerCase().includes(needle) || (i.wbsCode ?? "").includes(needle) || String(i.externalId ?? "").includes(needle));
    }
    if (scope !== "all") r = r.filter((i) => i.coarseScope === scope);
    return r;
  }, [issues, q, scope]);

  async function dismiss(issue: CompletenessIssue) {
    const key = `${issue.canonicalActivityKey}::${issue.coarseScope}`;
    setBusyKey(key);
    await fetch("/api/completeness/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, canonicalActivityKey: issue.canonicalActivityKey, coarseScope: issue.coarseScope }),
    });
    setBusyKey(null);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / WBS / ID"
          className="min-w-[12rem] flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <select value={scope} onChange={(e) => setScope(e.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm">
          <option value="all">All coarse scopes</option>
          {coarseScopes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <p className="mb-2 text-xs text-slate-500">{view.length} flagged activities</p>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {view.map((i) => {
          const key = `${i.canonicalActivityKey}::${i.coarseScope}`;
          return (
            <li key={key} className="px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <span>
                  <span className="mr-2 text-xs text-slate-400">{i.wbsCode}</span>
                  <span className="font-medium">{i.name}</span>
                </span>
                <button
                  disabled={busyKey === key}
                  onClick={() => dismiss(i)}
                  className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                >
                  {busyKey === key ? "Dismissing…" : "Dismiss"}
                </button>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{i.coarseScope}</span>
                should be tracked as: {i.finerScopes.join(", ")}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Implement the page**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCompleteness } from "@/lib/completeness/completenessService";
import { CompletenessIssuesTable } from "@/components/CompletenessIssuesTable";

export const dynamic = "force-dynamic";

export default async function CompletenessPage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const completeness = await getCompleteness(project.id);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Completeness</h1>
      {!completeness.hasImport ? (
        <p className="text-slate-500">Import a schedule first.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-500">{completeness.summary.total} activities flagged as too coarse</p>
          {completeness.issues.length === 0 ? (
            <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              No coarse activities flagged.
            </p>
          ) : (
            <CompletenessIssuesTable projectId={project.id} issues={completeness.issues} />
          )}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Build and manually verify**

```bash
npm run build
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add components/CompletenessIssuesTable.tsx app/projects/[id]/completeness/page.tsx
git commit -m "feat(completeness): completeness page, issues table, and dismiss action"
```

---

### Task 9: Nav link and full verification

**Files:**
- Modify: `app/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — wiring only.

- [ ] **Step 1: Add the nav link**

In `app/projects/[id]/page.tsx`, add a new `Link` next to the existing "Schedule health" link:

```tsx
          <Link href={`/projects/${project.id}/health`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Schedule health
          </Link>
          <Link href={`/projects/${project.id}/completeness`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Completeness
          </Link>
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all existing tests still pass, plus the new completeness/split-rule suites (passing if `DATABASE_URL` is set, skipped otherwise) — total test-file count should increase from 23 to 26 (`completenessChecks.test.ts`, `completenessService.test.ts`, `splitRuleService.test.ts`).

- [ ] **Step 3: Run the full build**

```bash
npm run build
```

Expected: success, no type errors.

- [ ] **Step 4: Manual smoke test** (requires `DATABASE_URL` pointed at the Railway public proxy, per `docs/SLICE5_HANDOFF.md`)

1. Open a project with an import → **Normalize scopes**.
2. In the new **Split rules** section, add coarse scope `MEP Rough` with finer scope `Electrical Rough-In`, then add a second finer scope `Plumbing Rough-In`.
3. Navigate to the project page → **Completeness**.
4. Confirm any activity named/mapped to "MEP Rough" is listed with "should be tracked as: Electrical Rough-In, Plumbing Rough-In".
5. Click **Dismiss** on one flagged activity → confirm it disappears from the list.
6. Re-import the same schedule file → confirm the dismissed activity is still suppressed (`canonicalActivityKey` survived re-import).

- [ ] **Step 5: Update the handoff doc**

In `docs/SLICE5_HANDOFF.md`, move Slice 5c from "Suggested next steps" into "Live in production" (mirroring how 5d was marked live), and update the test count and resume line.

- [ ] **Step 6: Commit**

```bash
git add app/projects/[id]/page.tsx docs/SLICE5_HANDOFF.md
git commit -m "feat(completeness): nav link; docs: mark Slice 5c live"
```

---

## Self-Review Notes

- **Spec coverage:** §4 data model → Task 1; §5 authoring UX → Tasks 2, 3, 7; §6 check logic/service/page/dismiss → Tasks 4, 5, 6, 8; §6 nav link → Task 9; §8 testing → covered in each task's DB-gated/unit tests plus Task 9's full-suite run and manual smoke test matching the spec's smoke-test steps exactly.
- **Type consistency checked:** `CompletenessIssue` (Task 4) is consumed unchanged by `completenessService.ts` (Task 5), `CompletenessIssuesTable.tsx` (Task 8); `SplitRuleRow` (Task 7) matches the `{ coarseScope, finerScopes }` shape produced by mapping `getSplitRules()`'s `Map<string, string[]>` on the Normalize page.
- **Non-goals respected:** no template/coverage logic, no AI suggestion, no bulk-dismiss/undo UI, no mutation of `Activity`/`ScheduleImport` anywhere in this plan.
