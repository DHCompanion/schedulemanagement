# Slice 5f — Completeness Accept/Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user Accept a Completeness issue — the coarse activity is replaced, in a new schedule snapshot, by its finer breakdown running in parallel — with that snapshot visible everywhere immediately, and Export able to generate a real MS Project XML for it.

**Architecture:** A new synthetic `ScheduleImport` (cloned from the current latest, coarse activity swapped for N parallel finer ones) becomes the new "latest" — every existing latest-import reader picks it up for free. A `CompletenessSplit` row records the operation so Export can later replay it against the real file the user re-uploads, walking back through `derivedFromImportId` to find that file's matching real ancestor import.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + Postgres, Vitest, TypeScript strict, fast-xml-parser.

## Global Constraints

- TypeScript strict mode — no `any`.
- DB-gated tests run only with `DATABASE_URL` set (`describe.runIf(hasDb)`), self-clean via `afterAll`, use a `30000`ms timeout for multi-round-trip tests. (Note: this repo's Vitest config auto-loads `.env` via Vite, so `DATABASE_URL` is already set when running `npm run test` locally — no manual `source .env` needed.)
- No DB mutation of imported `Activity` rows from real uploads — the coarse activity is removed only from the new *synthetic* snapshot, never from the import that produced it.
- Commit per task. Run `npm run test && npm run build` before considering any task done.
- No AI/LLM. Deterministic logic only.
- Accept is available to any logged-in user — not admin-gated (matches Dismiss's access level, per the spec's decision).

---

## Task 1: Migration — `CompletenessSplit` table + `ScheduleImport` lineage columns

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260622090000_add_completeness_split/migration.sql`

**Interfaces:**
- Produces: `ScheduleImport.isSynthetic: boolean`, `ScheduleImport.derivedFromImportId: string | null` on the Prisma client; a new `prisma.completenessSplit` model with fields `id, projectId, sourceScheduleImportId, resultScheduleImportId, coarseExternalUid, coarseWbsCode, coarseOutlineNumber, coarseOutlineLevel, coarseName, coarseDurationMinutes, coarseStart, coarseFinish, finerScopes (Json), mintedUids (Json), acceptedBy, createdAt`.

- [ ] **Step 1: Add the schema changes**

In `prisma/schema.prisma`, add to `model Project` (alongside the existing `completenessDismissals` line):

```prisma
  completenessSplits     CompletenessSplit[]
```

Add to `model ScheduleImport` (alongside the existing relation fields, e.g. after `progressUpdates`):

```prisma
  isSynthetic            Boolean          @default(false)
  derivedFromImportId    String?
  derivedFromImport      ScheduleImport?  @relation("ImportLineage", fields: [derivedFromImportId], references: [id])
  derivedImports         ScheduleImport[] @relation("ImportLineage")
  completenessSplits     CompletenessSplit[]
```

Add a new model, anywhere after `model CompletenessDismissal`:

```prisma
model CompletenessSplit {
  id                     String   @id @default(cuid())
  projectId              String
  project                Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  sourceScheduleImportId String                      // the import this was accepted from
  resultScheduleImportId String   @unique             // the synthetic import this created
  resultScheduleImport   ScheduleImport @relation(fields: [resultScheduleImportId], references: [id], onDelete: Cascade)
  coarseExternalUid      Int                          // for locating the task in the export XML
  coarseWbsCode          String?
  coarseOutlineNumber    String?
  coarseOutlineLevel     Int      @default(0)
  coarseName             String
  coarseDurationMinutes  Float?
  coarseStart            DateTime?
  coarseFinish           DateTime?
  finerScopes            Json                         // ordered string[]
  mintedUids             Json                         // ordered number[], same order as finerScopes
  acceptedBy             String?
  createdAt              DateTime @default(now())

  @@index([projectId])
}
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260622090000_add_completeness_split/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "ScheduleImport" ADD COLUMN "isSynthetic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScheduleImport" ADD COLUMN "derivedFromImportId" TEXT;

-- CreateTable
CREATE TABLE "CompletenessSplit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceScheduleImportId" TEXT NOT NULL,
    "resultScheduleImportId" TEXT NOT NULL,
    "coarseExternalUid" INTEGER NOT NULL,
    "coarseWbsCode" TEXT,
    "coarseOutlineNumber" TEXT,
    "coarseOutlineLevel" INTEGER NOT NULL DEFAULT 0,
    "coarseName" TEXT NOT NULL,
    "coarseDurationMinutes" DOUBLE PRECISION,
    "coarseStart" TIMESTAMP(3),
    "coarseFinish" TIMESTAMP(3),
    "finerScopes" JSONB NOT NULL,
    "mintedUids" JSONB NOT NULL,
    "acceptedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletenessSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompletenessSplit_resultScheduleImportId_key" ON "CompletenessSplit"("resultScheduleImportId");

-- CreateIndex
CREATE INDEX "CompletenessSplit_projectId_idx" ON "CompletenessSplit"("projectId");

-- AddForeignKey
ALTER TABLE "ScheduleImport" ADD CONSTRAINT "ScheduleImport_derivedFromImportId_fkey" FOREIGN KEY ("derivedFromImportId") REFERENCES "ScheduleImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletenessSplit" ADD CONSTRAINT "CompletenessSplit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompletenessSplit" ADD CONSTRAINT "CompletenessSplit_resultScheduleImportId_fkey" FOREIGN KEY ("resultScheduleImportId") REFERENCES "ScheduleImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Apply the migration and regenerate the client**

Run: `npx prisma migrate deploy`
Expected: `1 migration found` / `applied`.

Run: `npx prisma generate`
Expected: Prisma client regenerated with `isSynthetic`, `derivedFromImportId`, and the `completenessSplit` model.

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260622090000_add_completeness_split
git commit -m "feat(completeness): add CompletenessSplit table and ScheduleImport lineage columns"
```

---

## Task 2: `minutesToIsoDuration` — the inverse duration formatter

**Files:**
- Modify: `lib/msp/duration.ts`
- Modify: `tests/msp/duration.test.ts`

**Interfaces:**
- Produces: `minutesToIsoDuration(minutes: number | null): string | null`.

- [ ] **Step 1: Write the failing test**

Append to `tests/msp/duration.test.ts`:

```typescript
import { minutesToIsoDuration } from "@/lib/msp/duration";

describe("minutesToIsoDuration", () => {
  it("round-trips with parseIsoDurationToMinutes", () => {
    expect(minutesToIsoDuration(480)).toBe("PT8H0M0S");
    expect(parseIsoDurationToMinutes(minutesToIsoDuration(480)!)).toBe(480);
    expect(minutesToIsoDuration(90)).toBe("PT1H30M0S");
    expect(minutesToIsoDuration(2400)).toBe("PT40H0M0S");
  });
  it("returns null for null", () => {
    expect(minutesToIsoDuration(null)).toBeNull();
  });
});
```

(Add `minutesToIsoDuration` to the existing `import { parseIsoDurationToMinutes, tenthsOfMinuteToMinutes, minutesToDays } from "@/lib/msp/duration";` line at the top of the file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/msp/duration.test.ts`
Expected: FAIL — `minutesToIsoDuration` is not exported.

- [ ] **Step 3: Implement in `lib/msp/duration.ts`**

Add at the end of the file:

```typescript
/** Inverse of parseIsoDurationToMinutes: format minutes back to an ISO-8601 duration like "PT8H0M0S". */
export function minutesToIsoDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  const totalSeconds = Math.round(minutes * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `PT${hours}H${mins}M${secs}S`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/msp/duration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/msp/duration.ts tests/msp/duration.test.ts
git commit -m "feat(export): add minutesToIsoDuration, the inverse duration formatter"
```

---

## Task 3: `injectSplits` — build new Task/PredecessorLink XML nodes

**Files:**
- Create: `lib/export/injectSplits.ts`
- Create: `tests/export/injectSplits.test.ts`

**Interfaces:**
- Consumes: `toMspdiDate` from `lib/export/mspdiDate.ts`; `minutesToIsoDuration` from `lib/msp/duration.ts` (Task 2).
- Produces:
  ```typescript
  export interface SplitForExport {
    coarseExternalUid: number;
    coarseWbsCode: string | null;
    coarseOutlineNumber: string | null;
    coarseOutlineLevel: number;
    coarseDurationMinutes: number | null;
    coarseStart: Date | null;
    coarseFinish: Date | null;
    finerScopes: string[];
    mintedUids: number[];
  }
  export function injectSplits(doc: Record<string, unknown>, splits: SplitForExport[]): Record<string, unknown>
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/export/injectSplits.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { injectSplits, type SplitForExport } from "@/lib/export/injectSplits";

function doc() {
  return {
    Project: {
      Tasks: {
        Task: [
          { UID: "1", Name: "Predecessor", WBS: "1", OutlineNumber: "1", OutlineLevel: "1" },
          {
            UID: "2", Name: "Drywall", WBS: "2", OutlineNumber: "2", OutlineLevel: "1",
            Start: "2026-03-02T08:00:00", Finish: "2026-03-09T17:00:00", Duration: "PT2400M0S",
            PredecessorLink: { PredecessorUID: "1", Type: "1", LinkLag: "0", LagFormat: "7" },
          },
          {
            UID: "3", Name: "Successor", WBS: "3", OutlineNumber: "3", OutlineLevel: "1",
            PredecessorLink: { PredecessorUID: "2", Type: "1", LinkLag: "0", LagFormat: "7" },
          },
        ],
      },
    },
  } as Record<string, unknown>;
}
function tasks(d: Record<string, unknown>) {
  return ((d.Project as any).Tasks.Task) as any[];
}

const split: SplitForExport = {
  coarseExternalUid: 2,
  coarseWbsCode: "2",
  coarseOutlineNumber: "2",
  coarseOutlineLevel: 1,
  coarseDurationMinutes: 2400,
  coarseStart: new Date("2026-03-02T08:00:00Z"),
  coarseFinish: new Date("2026-03-09T17:00:00Z"),
  finerScopes: ["Drywall Hang", "Drywall Tape"],
  mintedUids: [101, 102],
};

describe("injectSplits", () => {
  it("replaces the coarse task with N parallel splits, fanning predecessors out and successors in", () => {
    const d = doc();
    injectSplits(d, [split]);
    const ts = tasks(d);
    expect(ts.map((t) => t.UID)).toEqual(["1", "101", "102", "3"]);

    const hang = ts.find((t) => t.UID === "101");
    expect(hang.Name).toBe("Drywall Hang");
    expect(hang.WBS).toBe("2.1");
    expect(hang.OutlineNumber).toBe("2.1");
    expect(hang.OutlineLevel).toBe("1");
    expect(hang.Start).toBe("2026-03-02T08:00:00");
    expect(hang.Finish).toBe("2026-03-09T17:00:00");
    expect(hang.Duration).toBe("PT40H0M0S");
    expect(hang.PredecessorLink).toEqual({ PredecessorUID: "1", Type: "1", LinkLag: "0", LagFormat: "7" });

    const tape = ts.find((t) => t.UID === "102");
    expect(tape.WBS).toBe("2.2");
    expect(tape.PredecessorLink).toEqual({ PredecessorUID: "1", Type: "1", LinkLag: "0", LagFormat: "7" });

    const successor = ts.find((t) => t.UID === "3");
    expect(successor.PredecessorLink).toEqual([
      { PredecessorUID: "101", Type: "1", LinkLag: "0", LagFormat: "7" },
      { PredecessorUID: "102", Type: "1", LinkLag: "0", LagFormat: "7" },
    ]);
  });

  it("leaves the document untouched when the coarse UID isn't found", () => {
    const d = doc();
    injectSplits(d, [{ ...split, coarseExternalUid: 999 }]);
    expect(tasks(d).map((t) => t.UID)).toEqual(["1", "2", "3"]);
  });

  it("applies multiple splits in the same document", () => {
    const d = doc();
    const split2: SplitForExport = { ...split, coarseExternalUid: 1, coarseWbsCode: "1", coarseOutlineNumber: "1", finerScopes: ["Mob A"], mintedUids: [201] };
    injectSplits(d, [split2, split]);
    expect(tasks(d).map((t) => t.UID)).toEqual(["201", "101", "102", "3"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/export/injectSplits.test.ts`
Expected: FAIL — cannot find module `@/lib/export/injectSplits`.

- [ ] **Step 3: Implement `lib/export/injectSplits.ts`**

```typescript
import { toMspdiDate } from "@/lib/export/mspdiDate";
import { minutesToIsoDuration } from "@/lib/msp/duration";

export interface SplitForExport {
  coarseExternalUid: number;
  coarseWbsCode: string | null;
  coarseOutlineNumber: string | null;
  coarseOutlineLevel: number;
  coarseDurationMinutes: number | null;
  coarseStart: Date | null;
  coarseFinish: Date | null;
  finerScopes: string[];
  mintedUids: number[];
}

type AnyRec = Record<string, unknown>;

function asArray(v: unknown): AnyRec[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as AnyRec[];
}

function buildNewTask(split: SplitForExport, name: string, uid: number, index: number, predecessors: AnyRec[]): AnyRec {
  const task: AnyRec = {
    UID: String(uid),
    ID: String(uid),
    Name: name,
    OutlineLevel: String(split.coarseOutlineLevel),
    Type: "1",
    Milestone: "0",
    Summary: "0",
    IsNull: "0",
  };
  if (split.coarseWbsCode) task.WBS = `${split.coarseWbsCode}.${index + 1}`;
  if (split.coarseOutlineNumber) task.OutlineNumber = `${split.coarseOutlineNumber}.${index + 1}`;
  if (split.coarseStart) task.Start = toMspdiDate(split.coarseStart);
  if (split.coarseFinish) task.Finish = toMspdiDate(split.coarseFinish);
  const duration = minutesToIsoDuration(split.coarseDurationMinutes);
  if (duration) task.Duration = duration;
  if (predecessors.length === 1) task.PredecessorLink = { ...predecessors[0] };
  else if (predecessors.length > 1) task.PredecessorLink = predecessors.map((p) => ({ ...p }));
  return task;
}

/** Mutate the Tasks list: replace each split's coarse <Task> with N parallel finer <Task> nodes, fanning predecessors out and successors in via <PredecessorLink>. */
export function injectSplits(doc: AnyRec, splits: SplitForExport[]): AnyRec {
  const project = doc.Project as AnyRec | undefined;
  const tasksNode = project?.Tasks as AnyRec | undefined;
  if (!tasksNode) return doc;
  let tasks = asArray(tasksNode.Task);

  for (const split of splits) {
    const coarseIndex = tasks.findIndex((t) => Number(t.UID) === split.coarseExternalUid);
    if (coarseIndex === -1) continue;
    const coarsePredecessors = asArray(tasks[coarseIndex].PredecessorLink);

    const newTasks = split.finerScopes.map((name, i) => buildNewTask(split, name, split.mintedUids[i], i, coarsePredecessors));
    tasks.splice(coarseIndex, 1, ...newTasks);

    for (const t of tasks) {
      const links = asArray(t.PredecessorLink);
      if (!links.some((l) => Number(l.PredecessorUID) === split.coarseExternalUid)) continue;
      const rebuilt: AnyRec[] = [];
      for (const l of links) {
        if (Number(l.PredecessorUID) !== split.coarseExternalUid) {
          rebuilt.push(l);
          continue;
        }
        for (const uid of split.mintedUids) rebuilt.push({ ...l, PredecessorUID: String(uid) });
      }
      t.PredecessorLink = rebuilt.length === 1 ? rebuilt[0] : rebuilt;
    }
  }

  tasksNode.Task = tasks;
  return doc;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/export/injectSplits.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/export/injectSplits.ts tests/export/injectSplits.test.ts
git commit -m "feat(export): add injectSplits to build new Task/PredecessorLink XML nodes"
```

---

## Task 4: `acceptSplit` service, `resolveExportBase`, and the Accept route

**Files:**
- Create: `lib/completeness/acceptSplit.ts`
- Create: `app/api/completeness/accept/route.ts`
- Create: `tests/completeness/acceptSplit.test.ts`

**Interfaces:**
- Consumes: `getSplitRules` from `lib/completeness/splitRuleService.ts`; `canonicalActivityKey` (aliased) from `lib/msp/canonicalKey.ts`; `getCompleteness` from `lib/completeness/completenessService.ts` (for the test only).
- Produces:
  ```typescript
  export async function acceptSplit(
    projectId: string,
    canonicalActivityKey: string,
    coarseScope: string,
    acceptedBy?: string,
  ): Promise<{ newImportId: string }>

  export async function resolveExportBase(
    latestImportId: string,
  ): Promise<{ baseImport: ScheduleImport; splits: CompletenessSplit[] }>
  ```
  where `ScheduleImport` and `CompletenessSplit` are the Prisma model types imported from `@prisma/client`.

- [ ] **Step 1: Write the failing tests**

Create `tests/completeness/acceptSplit.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { acceptSplit, resolveExportBase } from "@/lib/completeness/acceptSplit";
import { getCompleteness } from "@/lib/completeness/completenessService";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("acceptSplit", () => {
  let projectId = "";
  let firstImportId = "";
  let newImportId = "";
  const coarse = `ZZ Accept Coarse ${Date.now()}`;

  afterAll(async () => {
    await prisma.scopeSplitRule.deleteMany({ where: { coarseScope: coarse } });
    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: coarse.toLowerCase() } });
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("clones the latest import minus the coarse activity plus its splits, fans relationships, and records a CompletenessSplit", async () => {
    await prisma.scopeSplitRule.createMany({
      data: [
        { coarseScope: coarse, finerScope: "Finer A" },
        { coarseScope: coarse, finerScope: "Finer B" },
      ],
    });
    await prisma.scopeDictionaryEntry.upsert({
      where: { normalizedName: coarse.toLowerCase() },
      create: { normalizedName: coarse.toLowerCase(), canonicalScope: coarse },
      update: { canonicalScope: coarse },
    });

    const project = await prisma.project.create({ data: { name: "Accept Split Test" } });
    projectId = project.id;
    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h1" },
    });
    firstImportId = imp.id;
    const coarseKey = `2|${coarse.toLowerCase()}`;
    await prisma.activity.createMany({
      data: [
        { scheduleImportId: imp.id, externalUid: 1, wbsCode: "1", name: "Predecessor", canonicalActivityKey: "1|predecessor", type: "task" },
        {
          scheduleImportId: imp.id, externalUid: 2, wbsCode: "2", name: coarse, canonicalActivityKey: coarseKey, type: "task",
          durationMinutes: 2400, plannedStart: new Date("2026-03-02"), plannedFinish: new Date("2026-03-09"),
        },
        { scheduleImportId: imp.id, externalUid: 3, wbsCode: "3", name: "Successor", canonicalActivityKey: "3|successor", type: "task" },
      ],
    });
    await prisma.relationship.createMany({
      data: [
        { scheduleImportId: imp.id, predecessorExternalUid: 1, successorExternalUid: 2, type: "FS" },
        { scheduleImportId: imp.id, predecessorExternalUid: 2, successorExternalUid: 3, type: "FS" },
      ],
    });

    const result = await acceptSplit(project.id, coarseKey, coarse);
    newImportId = result.newImportId;

    const newImport = await prisma.scheduleImport.findUnique({
      where: { id: newImportId },
      include: { activities: true, relationships: true },
    });
    expect(newImport?.isSynthetic).toBe(true);
    expect(newImport?.derivedFromImportId).toBe(imp.id);

    const names = newImport!.activities.map((a) => a.name).sort();
    expect(names).toEqual(["Finer A", "Finer B", "Predecessor", "Successor"]);

    const finerA = newImport!.activities.find((a) => a.name === "Finer A")!;
    const finerB = newImport!.activities.find((a) => a.name === "Finer B")!;
    expect(finerA.wbsCode).toBe("2.1");
    expect(finerB.wbsCode).toBe("2.2");
    expect(finerA.durationMinutes).toBe(2400);
    expect(finerA.plannedStart?.toISOString()).toBe(new Date("2026-03-02").toISOString());
    expect(finerA.externalUid).not.toBe(finerB.externalUid);

    const rels = newImport!.relationships;
    expect(rels.some((r) => r.predecessorExternalUid === 1 && r.successorExternalUid === finerA.externalUid)).toBe(true);
    expect(rels.some((r) => r.predecessorExternalUid === 1 && r.successorExternalUid === finerB.externalUid)).toBe(true);
    expect(rels.some((r) => r.predecessorExternalUid === finerA.externalUid && r.successorExternalUid === 3)).toBe(true);
    expect(rels.some((r) => r.predecessorExternalUid === finerB.externalUid && r.successorExternalUid === 3)).toBe(true);
    expect(rels.some((r) => r.predecessorExternalUid === 2 || r.successorExternalUid === 2)).toBe(false);

    const split = await prisma.completenessSplit.findUnique({ where: { resultScheduleImportId: newImportId } });
    expect(split?.sourceScheduleImportId).toBe(imp.id);
    expect(split?.coarseExternalUid).toBe(2);
    expect(split?.coarseName).toBe(coarse);
    expect(split?.finerScopes).toEqual(["Finer A", "Finer B"]);

    const completeness = await getCompleteness(project.id);
    expect(completeness.issues).toHaveLength(0);
  }, 30000);

  it("resolveExportBase walks back through the synthetic import to the real ancestor", async () => {
    const { baseImport, splits } = await resolveExportBase(newImportId);
    expect(baseImport.id).toBe(firstImportId);
    expect(baseImport.isSynthetic).toBe(false);
    expect(splits).toHaveLength(1);
    expect(splits[0].coarseName).toBe(coarse);
  }, 15000);

  it("route accepts and returns the new import id", async () => {
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
    const project = await prisma.project.create({ data: { name: "Accept Route Test" } });
    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h2" },
    });
    const key = `1|${coarse.toLowerCase()}`;
    await prisma.activity.create({
      data: { scheduleImportId: imp.id, externalUid: 1, wbsCode: "1", name: coarse, canonicalActivityKey: key, type: "task" },
    });

    const { POST } = await import("@/app/api/completeness/accept/route");
    const res = await POST(new Request("http://localhost/api/completeness/accept", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, canonicalActivityKey: key, coarseScope: coarse }),
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.newImportId).toBeTruthy();

    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);

  it("route rejects a missing projectId", async () => {
    const { POST } = await import("@/app/api/completeness/accept/route");
    const res = await POST(new Request("http://localhost/api/completeness/accept", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canonicalActivityKey: "x", coarseScope: "y" }),
    }));
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/completeness/acceptSplit.test.ts`
Expected: FAIL — cannot find module `@/lib/completeness/acceptSplit` or `@/app/api/completeness/accept/route`.

- [ ] **Step 3: Implement `lib/completeness/acceptSplit.ts`**

```typescript
import { Prisma, type ScheduleImport, type CompletenessSplit } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canonicalActivityKey as buildCanonicalActivityKey } from "@/lib/msp/canonicalKey";
import { getSplitRules } from "@/lib/completeness/splitRuleService";

export async function acceptSplit(
  projectId: string,
  canonicalActivityKey: string,
  coarseScope: string,
  acceptedBy?: string,
): Promise<{ newImportId: string }> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true, relationships: true },
  });
  if (!latest) throw new Error("No imported schedule to split.");

  const coarse = latest.activities.find((a) => a.canonicalActivityKey === canonicalActivityKey);
  if (!coarse) throw new Error("Activity not found in the latest import.");

  const splitRules = await getSplitRules();
  const finerScopes = splitRules.get(coarseScope);
  if (!finerScopes || finerScopes.length === 0) throw new Error("No split rule found for this coarse scope.");

  const { _max } = await prisma.activity.aggregate({
    where: { scheduleImport: { projectId } },
    _max: { externalUid: true },
  });
  const startUid = (_max.externalUid ?? 0) + 1;
  const mintedUids = finerScopes.map((_, i) => startUid + i);

  const newImportId = await prisma.$transaction(async (tx) => {
    const created = await tx.scheduleImport.create({
      data: {
        projectId,
        sourceFormat: latest.sourceFormat,
        fileName: latest.fileName,
        fileHash: latest.fileHash,
        statusDate: latest.statusDate,
        projectStart: latest.projectStart,
        projectFinish: latest.projectFinish,
        minutesPerDay: latest.minutesPerDay,
        minutesPerWeek: latest.minutesPerWeek,
        daysPerMonth: latest.daysPerMonth,
        isSynthetic: true,
        derivedFromImportId: latest.id,
        notes: `Split "${coarse.name}" into: ${finerScopes.join(", ")}`,
      },
    });

    const otherActivities = latest.activities.filter((a) => a.id !== coarse.id);
    if (otherActivities.length) {
      await tx.activity.createMany({
        data: otherActivities.map((a) => ({
          scheduleImportId: created.id,
          externalUid: a.externalUid,
          externalGuid: a.externalGuid,
          externalId: a.externalId,
          wbsCode: a.wbsCode,
          outlineNumber: a.outlineNumber,
          outlineLevel: a.outlineLevel,
          parentExternalUid: a.parentExternalUid,
          name: a.name,
          canonicalActivityKey: a.canonicalActivityKey,
          type: a.type,
          rawType: a.rawType,
          isMilestone: a.isMilestone,
          isSummary: a.isSummary,
          isProjectSummary: a.isProjectSummary,
          isCritical: a.isCritical,
          isActive: a.isActive,
          plannedStart: a.plannedStart,
          plannedFinish: a.plannedFinish,
          earlyStart: a.earlyStart,
          earlyFinish: a.earlyFinish,
          lateStart: a.lateStart,
          lateFinish: a.lateFinish,
          actualStart: a.actualStart,
          actualFinish: a.actualFinish,
          baselineStart: a.baselineStart,
          baselineFinish: a.baselineFinish,
          baselineDurationMinutes: a.baselineDurationMinutes,
          durationMinutes: a.durationMinutes,
          durationDays: a.durationDays,
          remainingDurationMinutes: a.remainingDurationMinutes,
          actualDurationMinutes: a.actualDurationMinutes,
          percentComplete: a.percentComplete,
          percentWorkComplete: a.percentWorkComplete,
          totalSlackMinutes: a.totalSlackMinutes,
          freeSlackMinutes: a.freeSlackMinutes,
          constraintType: a.constraintType,
          constraintDate: a.constraintDate,
          deadline: a.deadline,
          calendarExternalUid: a.calendarExternalUid,
          customFields: a.customFields === null ? Prisma.JsonNull : (a.customFields as Prisma.InputJsonValue),
          rawBaselines: a.rawBaselines === null ? Prisma.JsonNull : (a.rawBaselines as Prisma.InputJsonValue),
        })),
      });
    }

    await tx.activity.createMany({
      data: finerScopes.map((scope, i) => {
        const wbsCode = coarse.wbsCode ? `${coarse.wbsCode}.${i + 1}` : null;
        return {
          scheduleImportId: created.id,
          externalUid: mintedUids[i],
          externalId: mintedUids[i],
          wbsCode,
          outlineNumber: coarse.outlineNumber ? `${coarse.outlineNumber}.${i + 1}` : null,
          outlineLevel: coarse.outlineLevel,
          parentExternalUid: coarse.parentExternalUid,
          name: scope,
          canonicalActivityKey: buildCanonicalActivityKey(wbsCode, scope),
          type: coarse.type,
          isMilestone: coarse.isMilestone,
          isSummary: false,
          isProjectSummary: false,
          isCritical: false,
          isActive: true,
          plannedStart: coarse.plannedStart,
          plannedFinish: coarse.plannedFinish,
          durationMinutes: coarse.durationMinutes,
          durationDays: coarse.durationDays,
          remainingDurationMinutes: coarse.durationMinutes,
          percentComplete: 0,
          calendarExternalUid: coarse.calendarExternalUid,
        };
      }),
    });

    const otherRelationships = latest.relationships.filter(
      (r) => r.predecessorExternalUid !== coarse.externalUid && r.successorExternalUid !== coarse.externalUid,
    );
    if (otherRelationships.length) {
      await tx.relationship.createMany({
        data: otherRelationships.map((r) => ({
          scheduleImportId: created.id,
          predecessorExternalUid: r.predecessorExternalUid,
          successorExternalUid: r.successorExternalUid,
          type: r.type,
          rawType: r.rawType,
          lagMinutes: r.lagMinutes,
          rawLagFormat: r.rawLagFormat,
          crossProject: r.crossProject,
        })),
      });
    }

    const fanned: Prisma.RelationshipCreateManyInput[] = [];
    for (const r of latest.relationships.filter((r) => r.predecessorExternalUid === coarse.externalUid)) {
      for (const uid of mintedUids) {
        fanned.push({
          scheduleImportId: created.id,
          predecessorExternalUid: uid,
          successorExternalUid: r.successorExternalUid,
          type: r.type,
          rawType: r.rawType,
          lagMinutes: r.lagMinutes,
          rawLagFormat: r.rawLagFormat,
          crossProject: r.crossProject,
        });
      }
    }
    for (const r of latest.relationships.filter((r) => r.successorExternalUid === coarse.externalUid)) {
      for (const uid of mintedUids) {
        fanned.push({
          scheduleImportId: created.id,
          predecessorExternalUid: r.predecessorExternalUid,
          successorExternalUid: uid,
          type: r.type,
          rawType: r.rawType,
          lagMinutes: r.lagMinutes,
          rawLagFormat: r.rawLagFormat,
          crossProject: r.crossProject,
        });
      }
    }
    if (fanned.length) await tx.relationship.createMany({ data: fanned });

    await tx.scheduleImport.update({
      where: { id: created.id },
      data: {
        activityCount: otherActivities.length + finerScopes.length,
        relationshipCount: otherRelationships.length + fanned.length,
      },
    });

    await tx.completenessSplit.create({
      data: {
        projectId,
        sourceScheduleImportId: latest.id,
        resultScheduleImportId: created.id,
        coarseExternalUid: coarse.externalUid,
        coarseWbsCode: coarse.wbsCode,
        coarseOutlineNumber: coarse.outlineNumber,
        coarseOutlineLevel: coarse.outlineLevel,
        coarseName: coarse.name,
        coarseDurationMinutes: coarse.durationMinutes,
        coarseStart: coarse.plannedStart,
        coarseFinish: coarse.plannedFinish,
        finerScopes: finerScopes as Prisma.InputJsonValue,
        mintedUids: mintedUids as Prisma.InputJsonValue,
        acceptedBy: acceptedBy ?? null,
      },
    });

    return created.id;
  });

  return { newImportId };
}

/** Walk a (possibly synthetic) latest import back to its nearest real ancestor, collecting every CompletenessSplit along the way, oldest first. */
export async function resolveExportBase(
  latestImportId: string,
): Promise<{ baseImport: ScheduleImport; splits: CompletenessSplit[] }> {
  const splits: CompletenessSplit[] = [];
  let current = await prisma.scheduleImport.findUniqueOrThrow({ where: { id: latestImportId } });
  while (current.isSynthetic) {
    const split = await prisma.completenessSplit.findUnique({ where: { resultScheduleImportId: current.id } });
    if (!split) break;
    splits.unshift(split);
    if (!current.derivedFromImportId) break;
    current = await prisma.scheduleImport.findUniqueOrThrow({ where: { id: current.derivedFromImportId } });
  }
  return { baseImport: current, splits };
}
```

- [ ] **Step 4: Implement `app/api/completeness/accept/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { acceptSplit } from "@/lib/completeness/acceptSplit";

interface AcceptBody {
  projectId?: string;
  canonicalActivityKey?: string;
  coarseScope?: string;
  acceptedBy?: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as AcceptBody;
  if (!body.projectId || !body.canonicalActivityKey || !body.coarseScope) {
    return NextResponse.json({ error: { message: "projectId, canonicalActivityKey, and coarseScope are required." } }, { status: 422 });
  }
  try {
    const { newImportId } = await acceptSplit(body.projectId, body.canonicalActivityKey, body.coarseScope, body.acceptedBy);
    return NextResponse.json({ ok: true, newImportId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to accept.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- tests/completeness/acceptSplit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/completeness/acceptSplit.ts app/api/completeness/accept/route.ts tests/completeness/acceptSplit.test.ts
git commit -m "feat(completeness): add acceptSplit service, resolveExportBase, and the Accept route"
```

---

## Task 5: Completeness page — Accept button

**Files:**
- Modify: `components/CompletenessIssuesTable.tsx`

**Interfaces:**
- Consumes: `POST /api/completeness/accept` (Task 4).

No automated test for this task — matches the existing convention that client panel components in this codebase have no dedicated unit tests; correctness is covered by `npm run build` plus the manual smoke test below.

- [ ] **Step 1: Add the Accept button and confirm dialog**

Replace `components/CompletenessIssuesTable.tsx`:

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
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    await fetch("/api/completeness/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, canonicalActivityKey: issue.canonicalActivityKey, coarseScope: issue.coarseScope }),
    });
    setBusyKey(null);
    router.refresh();
  }

  async function accept(issue: CompletenessIssue) {
    const key = `${issue.canonicalActivityKey}::${issue.coarseScope}`;
    const confirmed = window.confirm(
      `Replace "${issue.name}" (WBS ${issue.wbsCode ?? "—"}) with ${issue.finerScopes.length} parallel activities — ` +
        `${issue.finerScopes.join(", ")} — each inheriting its predecessors, successors, and duration. Continue?`,
    );
    if (!confirmed) return;
    setBusyKey(key);
    setError(null);
    const res = await fetch("/api/completeness/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, canonicalActivityKey: issue.canonicalActivityKey, coarseScope: issue.coarseScope }),
    });
    setBusyKey(null);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Accept failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
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
          const busy = busyKey === key;
          return (
            <li key={key} className="px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <span>
                  <span className="mr-2 text-xs text-slate-400">{i.wbsCode}</span>
                  <span className="font-medium">{i.name}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    disabled={busy}
                    onClick={() => accept(i)}
                    className="whitespace-nowrap rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    {busy ? "Working…" : "Accept"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => dismiss(i)}
                    className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                  >
                    {busy ? "Working…" : "Dismiss"}
                  </button>
                </span>
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

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Manual smoke**

On a project with a flagged Completeness issue, click Accept, confirm the dialog → the issue disappears from Completeness, and the new split activities appear on the project dashboard and Health page (since the new synthetic import is now "latest").

- [ ] **Step 4: Commit**

```bash
git add components/CompletenessIssuesTable.tsx
git commit -m "feat(completeness): add an Accept button that triggers the split"
```

---

## Task 6: Wire `injectSplits` into `buildExport`

**Files:**
- Modify: `lib/export/buildExport.ts`
- Modify: `tests/export/buildExport.test.ts`

**Interfaces:**
- Consumes: `resolveExportBase` from `lib/completeness/acceptSplit.ts` (Task 4); `injectSplits`, `SplitForExport` from `lib/export/injectSplits.ts` (Task 3).
- Produces: `buildExport` return type gains `deletedTasks: { name: string; wbsCode: string | null }[]`.

- [ ] **Step 1: Write the failing test**

In `tests/export/buildExport.test.ts`, add `acceptSplit` to the imports and a new test. Add at the top:

```typescript
import { acceptSplit } from "@/lib/completeness/acceptSplit";
```

Add this test inside `describe.runIf(hasDb)("buildExport", ...)`, after the existing tests:

```typescript
  it("exports a synthetic split against the original real file", async () => {
    const coarse = `ZZ Export Split ${Date.now()}`;
    await prisma.scopeSplitRule.createMany({
      data: [
        { coarseScope: coarse, finerScope: "Finer A" },
        { coarseScope: coarse, finerScope: "Finer B" },
      ],
    });
    await prisma.scopeDictionaryEntry.upsert({
      where: { normalizedName: coarse.toLowerCase() },
      create: { normalizedName: coarse.toLowerCase(), canonicalScope: coarse },
      update: { canonicalScope: coarse },
    });

    const project = await prisma.project.create({ data: { name: "Export Split Test" } });
    await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });

    const latest = await prisma.scheduleImport.findFirstOrThrow({ where: { projectId: project.id }, include: { activities: true } });
    const electrical = latest.activities.find((a) => a.name === "Electrical Rough-In")!;
    await prisma.activity.update({ where: { id: electrical.id }, data: { name: coarse, canonicalActivityKey: `2|${coarse.toLowerCase()}` } });

    await acceptSplit(project.id, `2|${coarse.toLowerCase()}`, coarse);

    const out = await buildExport(project.id, xml, "minimal.xml");
    const doc = parseForExport(out.xml);
    const taskUids = ((doc.Project as any).Tasks.Task as any[]).map((t) => String(t.UID));
    expect(taskUids).not.toContain("2");
    expect(out.deletedTasks).toEqual([{ name: coarse, wbsCode: "2" }]);

    await prisma.scopeSplitRule.deleteMany({ where: { coarseScope: coarse } });
    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: coarse.toLowerCase() } });
    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/export/buildExport.test.ts`
Expected: FAIL — `out.deletedTasks` is `undefined`, or the fileHash check throws (since `latest.fileHash` no longer matches without the ancestor-walk).

- [ ] **Step 3: Implement the changes in `lib/export/buildExport.ts`**

Update the imports at the top:

```typescript
import { injectActuals, injectNames, type ProgressForExport } from "@/lib/export/injectActuals";
import { parseForExport, buildMspdi } from "@/lib/export/serializeMspdi";
import { toMspdiDate } from "@/lib/export/mspdiDate";
import { applyDictionary } from "@/lib/normalize/normalizationService";
import { resolveExportBase } from "@/lib/completeness/acceptSplit";
import { injectSplits, type SplitForExport } from "@/lib/export/injectSplits";
```

Update the return type and the function body. Replace the existing fileHash check:

```typescript
  if (latest.fileHash !== fileHash) {
    throw new Error("This file doesn't match the current imported schedule — export the file you most recently imported.");
  }
```

with:

```typescript
  const { baseImport, splits } = await resolveExportBase(latest.id);
  if (baseImport.fileHash !== fileHash) {
    throw new Error("This file doesn't match the current imported schedule — export the file you most recently imported.");
  }
```

Then, right after `const doc = parseForExport(uploadedXml);` and before `injectActuals(doc, progressByUid);`, add:

```typescript
  const splitsForExport: SplitForExport[] = splits.map((s) => ({
    coarseExternalUid: s.coarseExternalUid,
    coarseWbsCode: s.coarseWbsCode,
    coarseOutlineNumber: s.coarseOutlineNumber,
    coarseOutlineLevel: s.coarseOutlineLevel,
    coarseDurationMinutes: s.coarseDurationMinutes,
    coarseStart: s.coarseStart,
    coarseFinish: s.coarseFinish,
    finerScopes: s.finerScopes as string[],
    mintedUids: s.mintedUids as number[],
  }));
  injectSplits(doc, splitsForExport);
```

Finally, update the function's return statement (the last line) from:

```typescript
  return { fileName: `${base}-updated-${asOf}.xml`, xml };
```

to:

```typescript
  const deletedTasks = splits.map((s) => ({ name: s.coarseName, wbsCode: s.coarseWbsCode }));
  return { fileName: `${base}-updated-${asOf}.xml`, xml, deletedTasks };
```

And update the function's declared return type at the top of the file:

```typescript
export async function buildExport(
  projectId: string,
  uploadedXml: string,
  uploadedFileName: string,
): Promise<{ fileName: string; xml: string; deletedTasks: { name: string; wbsCode: string | null }[] }> {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/export/buildExport.test.ts`
Expected: PASS (4 tests). The original 3 tests still pass since a non-synthetic latest import's `resolveExportBase` returns itself as `baseImport` with `splits: []`, which is a no-op for `injectSplits` and produces `deletedTasks: []`.

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add lib/export/buildExport.ts tests/export/buildExport.test.ts
git commit -m "feat(export): apply the split chain and report deleted tasks in buildExport"
```

---

## Task 7: Export route header, ExportPanel checklist, README note

**Files:**
- Modify: `app/api/export/route.ts`
- Modify: `components/ExportPanel.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `buildExport`'s `deletedTasks` (Task 6).

No automated test for this task (response-header plumbing + client UI, no DB-gated route test exists for `/api/export` beyond what Task 6 already covers at the `buildExport` level) — build + manual smoke verify.

- [ ] **Step 1: Return the header from the export route**

Replace `app/api/export/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { buildExport } from "@/lib/export/buildExport";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  if (!(file instanceof File) || !projectId) {
    return NextResponse.json({ error: { message: "file and projectId are required." } }, { status: 400 });
  }
  const xml = await file.text();
  try {
    const out = await buildExport(projectId, xml, file.name);
    return new Response(out.xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml",
        "Content-Disposition": `attachment; filename="${out.fileName}"`,
        "X-Deleted-Tasks": JSON.stringify(out.deletedTasks),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Export failed.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
```

- [ ] **Step 2: Show the checklist in ExportPanel**

Replace `components/ExportPanel.tsx`:

```tsx
"use client";

import { useState } from "react";

interface DeletedTask {
  name: string;
  wbsCode: string | null;
}

export function ExportPanel({ projectId }: { projectId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletedTasks, setDeletedTasks] = useState<DeletedTask[] | null>(null);

  async function generate() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDeletedTasks(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("projectId", projectId);
    const res = await fetch("/api/export", { method: "POST", body: fd });
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Export failed.");
      setBusy(false);
      return;
    }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const name = cd.match(/filename="([^"]+)"/)?.[1] ?? "schedule-updated.xml";
    const tasksHeader = res.headers.get("X-Deleted-Tasks");
    if (tasksHeader) {
      const parsed: DeletedTask[] = JSON.parse(tasksHeader);
      if (parsed.length > 0) setDeletedTasks(parsed);
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="file" accept=".xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button disabled={!file || busy} onClick={generate} className="self-start rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Generating…" : "Generate updated file"}
      </button>
      {deletedTasks && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="mb-1 font-medium">
            This export replaces {deletedTasks.length} coarse activit{deletedTasks.length === 1 ? "y" : "ies"} with finer ones.
            After merging, manually delete these rows from MS Project:
          </p>
          <ul className="list-inside list-disc">
            {deletedTasks.map((t) => (
              <li key={`${t.wbsCode}-${t.name}`}>{t.name} (WBS {t.wbsCode ?? "—"})</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the README note**

In `README.md`, after the existing merge instructions' step 7 (`7. Finish the wizard — Project applies the actuals and recalculates.`) and before the "Notes:" paragraph, add:

```markdown
8. If the app's checklist flagged any replaced activities, manually delete those
   rows from the schedule now — Project's Unique-ID merge adds and updates tasks
   but never deletes them.
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Run full test suite**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 6: Manual smoke**

Accept a Completeness issue on a test project, then export it (re-uploading the original real file) → the downloaded file's name and content reflect the split, and the checklist banner lists the replaced activity by name and WBS.

- [ ] **Step 7: Commit**

```bash
git add app/api/export/route.ts components/ExportPanel.tsx README.md
git commit -m "feat(export): surface a manual-delete checklist for replaced activities"
```

---

## Task 8: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all tests pass (this repo's Vitest config auto-loads `.env`, so DB-gated suites run automatically when `DATABASE_URL` is present there).

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 3: End-to-end manual smoke**

1. On a project with a Completeness issue flagged (coarse scope with a split rule), click **Accept**, confirm the dialog.
2. Confirm the issue disappears from Completeness, and the new finer activities (with the coarse activity's WBS + `.1`/`.2`/etc.) appear immediately on the project dashboard and Health page.
3. Go to Export, re-upload the **original** file you imported (not anything downloaded since) → confirm it still works (proving the real-ancestor fileHash walk).
4. Open the downloaded XML → confirm the coarse task's `<UID>` is gone, the new tasks exist with copied duration/dates, the predecessor task's link is copied onto every new task, and the original successor's `<PredecessorLink>` now lists every new task's UID instead of the coarse one.
5. Confirm the checklist banner on the Export page names the right activity and WBS to delete manually.

- [ ] **Step 4: Update the handoff doc**

In `docs/SLICE5_HANDOFF.md`, add Slice 5f to the "Live in production" list (after 5e) summarizing: Completeness's Accept action, the synthetic-import mechanism, and Export's new split-injection + manual-delete checklist. Update the "Tests: N passing, M files" line to the new totals from Step 1's output.

- [ ] **Step 5: Commit**

```bash
git add docs/SLICE5_HANDOFF.md
git commit -m "docs: update handoff for Slice 5f (Completeness Accept/Split)"
```
