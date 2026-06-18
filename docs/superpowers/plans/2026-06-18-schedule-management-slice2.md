# Slice 2 — Lookahead + Weekly Update Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a field user record weekly progress on a project's 3/6-week lookahead and finalize it as an immutable, versioned snapshot — the historical-data engine behind Goal #1.

**Architecture:** Two new delta tables (`ProgressUpdate`, `ProgressEntry`) overlay the latest immutable import. A pure `computeLookahead` module selects/flag near-term activities; a pure `resolveCurrentProgress` resolver picks the latest finalized progress per `canonicalActivityKey`. A thin service layer handles the draft→finalize lifecycle; Next.js route handlers + server-component pages + one client form wire it to the UI. Record-only — no CPM recompute.

**Tech Stack:** Next.js 14 (App Router), TypeScript (strict), Prisma + PostgreSQL (Railway), Tailwind, Vitest.

## Global Constraints

- **Record only.** No CPM forward/backward pass, no forecast dates, no critical-path recompute.
- **Imports stay immutable.** Never mutate Slice 1 tables (`ScheduleImport`, `Activity`, etc.). Progress lives only in the two new tables.
- **Exact `canonicalActivityKey` matching** across re-imports. No fuzzy matching.
- **One `draft` `ProgressUpdate` per project.** Starting a new update resumes the existing draft.
- **Touched activities only.** Persist a `ProgressEntry` only for activities with non-default progress.
- **Naive-local dates** stored via `toDbDate` from `@/lib/import/commitImport` (treat date strings as UTC wall-clock; no timezone shifting).
- **Shared login stays.** No per-user auth; `submittedBy` is a nullable string.
- **No new test infrastructure.** Pure logic → Vitest unit tests; DB logic → `describe.runIf(!!process.env.DATABASE_URL)`; UI → `npm run build` + smoke. No React Testing Library (not in the project).
- **Status values:** `not_started` | `in_progress` | `complete`. **Slippage values:** `overdue` | `should-have-started` | `on-track`. **Lookahead weeks:** `3` | `6`.
- **`@/` path alias** maps to repo root (see `tsconfig.json`).
- Redirect responses from route handlers build their base URL with `requestBaseUrl` from `@/lib/http`.
- Run `npm run build` and `npm run test` before review. Commit schema + migration in one commit.

---

## File Structure

**Created:**
- `lib/lookahead/computeLookahead.ts` — pure lookahead selection + slippage flags
- `lib/lookahead/currentProgress.ts` — pure latest-finalized-progress resolver
- `lib/updates/updateService.ts` — draft lifecycle + entry persistence + finalized-entry query (DB)
- `app/api/updates/route.ts` — POST create/resume draft (form → redirect)
- `app/api/updates/[updateId]/entries/route.ts` — POST save entries (JSON)
- `app/api/updates/[updateId]/finalize/route.ts` — POST finalize (JSON)
- `app/projects/[id]/updates/page.tsx` — update history + start-update form
- `app/projects/[id]/updates/[updateId]/page.tsx` — editor / read-only view
- `components/LookaheadUpdateForm.tsx` — client per-activity progress form
- `tests/lookahead/computeLookahead.test.ts`, `tests/lookahead/currentProgress.test.ts`, `tests/updates/updateService.test.ts`, `tests/updates/progressModel.test.ts`

**Modified:**
- `prisma/schema.prisma` — add two models + back-relations
- `app/projects/[id]/page.tsx` — add nav link + overlay current progress into the verification view

---

## Task 1: Schema + migration for progress tables

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_progress_tables/migration.sql`
- Test: `tests/updates/progressModel.test.ts`

**Interfaces:**
- Produces: Prisma models `ProgressUpdate` and `ProgressEntry` (fields exactly as below); back-relations `Project.progressUpdates`, `ScheduleImport.progressUpdates`.

- [ ] **Step 1: Snapshot the current schema for an offline migration diff**

```bash
cp prisma/schema.prisma /tmp/schema-prev.prisma
```

- [ ] **Step 2: Add the two models to `prisma/schema.prisma`**

Append at end of file:

```prisma
model ProgressUpdate {
  id               String         @id @default(cuid())
  projectId        String
  project          Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  scheduleImportId String
  scheduleImport   ScheduleImport @relation(fields: [scheduleImportId], references: [id], onDelete: Cascade)
  asOfDate         DateTime
  lookaheadWeeks   Int            @default(3)
  state            String         @default("draft")
  submittedBy      String?
  note             String?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
  finalizedAt      DateTime?
  entries          ProgressEntry[]

  @@index([projectId])
  @@index([scheduleImportId])
}

model ProgressEntry {
  id                   String         @id @default(cuid())
  progressUpdateId     String
  progressUpdate       ProgressUpdate @relation(fields: [progressUpdateId], references: [id], onDelete: Cascade)
  activityExternalUid  Int
  canonicalActivityKey String
  status               String
  actualStart          DateTime?
  actualFinish         DateTime?
  percentComplete      Int?
  note                 String?
  createdAt            DateTime       @default(now())
  updatedAt            DateTime       @updatedAt

  @@index([progressUpdateId])
  @@index([canonicalActivityKey])
}
```

- [ ] **Step 3: Add back-relations to `Project` and `ScheduleImport`**

In `model Project`, after the `imports ScheduleImport[]` line, add:

```prisma
  progressUpdates ProgressUpdate[]
```

In `model ScheduleImport`, after the `calendars Calendar[]` line, add:

```prisma
  progressUpdates ProgressUpdate[]
```

- [ ] **Step 4: Validate the schema**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 5: Generate the additive migration offline (no DB needed)**

```bash
TS=$(date -u +%Y%m%d%H%M%S); DIR="prisma/migrations/${TS}_add_progress_tables"; mkdir -p "$DIR"; npx prisma migrate diff --from-schema-datamodel /tmp/schema-prev.prisma --to-schema-datamodel prisma/schema.prisma --script > "$DIR/migration.sql"; cat "$DIR/migration.sql"
```

Expected: two `CREATE TABLE "ProgressUpdate"` / `"ProgressEntry"` statements, their indexes, and two `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` statements. No `DROP`/`ALTER` of existing tables.

- [ ] **Step 6: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` with no errors.

- [ ] **Step 7: Write the DB-gated round-trip test**

Create `tests/updates/progressModel.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("progress tables", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("creates an update with an entry and cascades on delete", async () => {
    const project = await prisma.project.create({ data: { name: "Progress Model Test" } });
    projectId = project.id;
    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h" },
    });
    const upd = await prisma.progressUpdate.create({
      data: { projectId: project.id, scheduleImportId: imp.id, asOfDate: new Date("2026-06-18T00:00:00Z") },
    });
    await prisma.progressEntry.create({
      data: { progressUpdateId: upd.id, activityExternalUid: 1, canonicalActivityKey: "1|task", status: "in_progress", percentComplete: 50 },
    });
    const found = await prisma.progressUpdate.findUnique({ where: { id: upd.id }, include: { entries: true } });
    expect(found?.state).toBe("draft");
    expect(found?.entries.length).toBe(1);
    expect(found?.entries[0].percentComplete).toBe(50);

    await prisma.progressUpdate.delete({ where: { id: upd.id } });
    const orphans = await prisma.progressEntry.findMany({ where: { progressUpdateId: upd.id } });
    expect(orphans.length).toBe(0);
  });
});
```

- [ ] **Step 8: Run the test (applies migration first if a DB is available)**

If you have a Postgres `DATABASE_URL` (Railway or local), run `npx prisma migrate deploy` then the test; otherwise the suite skips the DB block:

Run: `npm run test -- tests/updates/progressModel.test.ts`
Expected: PASS when `DATABASE_URL` is set (1 test), or `1 skipped` when it is not.

- [ ] **Step 9: Commit schema + migration together**

```bash
git add prisma/schema.prisma prisma/migrations tests/updates/progressModel.test.ts
git commit -m "feat(db): add ProgressUpdate and ProgressEntry tables for weekly updates"
```

---

## Task 2: Pure lookahead computation module

**Files:**
- Create: `lib/lookahead/computeLookahead.ts`
- Test: `tests/lookahead/computeLookahead.test.ts`

**Interfaces:**
- Produces: types `ProgressStatus`, `ActivityProgress`, `SlippageFlag`, `LookaheadActivity`, `LookaheadRow`; functions `defaultProgress(): ActivityProgress`, `computeSlippage(a, p, asOfDate): SlippageFlag`, `computeLookahead(activities, progressByKey, asOfDate, weeks): LookaheadRow[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/lookahead/computeLookahead.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeLookahead, computeSlippage, defaultProgress,
  type LookaheadActivity, type ActivityProgress,
} from "@/lib/lookahead/computeLookahead";

const asOf = new Date("2026-06-18T00:00:00Z");

function act(p: Partial<LookaheadActivity>): LookaheadActivity {
  return {
    externalUid: 1, canonicalActivityKey: "1|a", wbsCode: "1", name: "A",
    type: "task", isActive: true, plannedStart: null, plannedFinish: null, ...p,
  };
}
const empty = new Map<string, ActivityProgress>();

describe("computeLookahead inclusion", () => {
  it("includes an activity starting within the window", () => {
    const rows = computeLookahead([act({ plannedStart: new Date("2026-06-25T00:00:00Z") })], empty, asOf, 3);
    expect(rows.length).toBe(1);
  });
  it("includes an activity finishing within the window", () => {
    const rows = computeLookahead([act({ plannedFinish: new Date("2026-06-25T00:00:00Z") })], empty, asOf, 3);
    expect(rows.length).toBe(1);
  });
  it("includes an activity spanning the as-of date", () => {
    const rows = computeLookahead([act({ plannedStart: new Date("2026-06-01T00:00:00Z"), plannedFinish: new Date("2026-07-30T00:00:00Z") })], empty, asOf, 3);
    expect(rows.length).toBe(1);
  });
  it("includes past-due incomplete via the catch-all", () => {
    const rows = computeLookahead([act({ plannedFinish: new Date("2026-06-10T00:00:00Z") })], empty, asOf, 3);
    expect(rows.length).toBe(1);
    expect(rows[0].slippage).toBe("overdue");
  });
  it("includes in-progress even if planned dates are outside the window", () => {
    const prog = new Map<string, ActivityProgress>([["1|a", { ...defaultProgress(), status: "in_progress" }]]);
    const rows = computeLookahead([act({ plannedStart: new Date("2026-09-01T00:00:00Z") })], prog, asOf, 3);
    expect(rows.length).toBe(1);
  });
  it("excludes activity entirely outside the window with no progress", () => {
    const rows = computeLookahead([act({ plannedStart: new Date("2026-09-01T00:00:00Z"), plannedFinish: new Date("2026-09-10T00:00:00Z") })], empty, asOf, 3);
    expect(rows.length).toBe(0);
  });
  it("excludes summary and inactive activities", () => {
    const inWindow = new Date("2026-06-25T00:00:00Z");
    const rows = computeLookahead([
      act({ externalUid: 1, type: "summary", plannedStart: inWindow }),
      act({ externalUid: 2, type: "project_summary", plannedStart: inWindow }),
      act({ externalUid: 3, isActive: false, plannedStart: inWindow }),
    ], empty, asOf, 3);
    expect(rows.length).toBe(0);
  });
  it("excludes past-due that is already complete", () => {
    const prog = new Map<string, ActivityProgress>([["1|a", { ...defaultProgress(), status: "complete" }]]);
    const rows = computeLookahead([act({ plannedFinish: new Date("2026-06-10T00:00:00Z") })], prog, asOf, 3);
    expect(rows.length).toBe(0);
  });
  it("6-week window includes what 3-week excludes", () => {
    const a = [act({ plannedStart: new Date("2026-07-20T00:00:00Z") })];
    expect(computeLookahead(a, empty, asOf, 3).length).toBe(0);
    expect(computeLookahead(a, empty, asOf, 6).length).toBe(1);
  });
});

describe("computeSlippage", () => {
  it("flags should-have-started for an unstarted past-start activity", () => {
    const s = computeSlippage(act({ plannedStart: new Date("2026-06-10T00:00:00Z") }), defaultProgress(), asOf);
    expect(s).toBe("should-have-started");
  });
  it("flags on-track for a future activity", () => {
    const s = computeSlippage(act({ plannedStart: new Date("2026-06-25T00:00:00Z") }), defaultProgress(), asOf);
    expect(s).toBe("on-track");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lookahead/computeLookahead.test.ts`
Expected: FAIL — `Cannot find module '@/lib/lookahead/computeLookahead'`.

- [ ] **Step 3: Implement the module**

Create `lib/lookahead/computeLookahead.ts`:

```ts
export type ProgressStatus = "not_started" | "in_progress" | "complete";
export type SlippageFlag = "overdue" | "should-have-started" | "on-track";

export interface ActivityProgress {
  status: ProgressStatus;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number | null;
  note: string | null;
}

export interface LookaheadActivity {
  externalUid: number;
  canonicalActivityKey: string;
  wbsCode: string | null;
  name: string;
  type: string;
  isActive: boolean;
  plannedStart: Date | null;
  plannedFinish: Date | null;
}

export interface LookaheadRow {
  externalUid: number;
  canonicalActivityKey: string;
  wbsCode: string | null;
  name: string;
  type: string;
  plannedStart: Date | null;
  plannedFinish: Date | null;
  progress: ActivityProgress;
  slippage: SlippageFlag;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function defaultProgress(): ActivityProgress {
  return { status: "not_started", actualStart: null, actualFinish: null, percentComplete: null, note: null };
}

export function computeSlippage(a: LookaheadActivity, p: ActivityProgress, asOfDate: Date): SlippageFlag {
  if (a.plannedFinish && a.plannedFinish < asOfDate && p.status !== "complete") return "overdue";
  if (a.plannedStart && a.plannedStart < asOfDate && p.status === "not_started") return "should-have-started";
  return "on-track";
}

export function computeLookahead(
  activities: LookaheadActivity[],
  progressByKey: Map<string, ActivityProgress>,
  asOfDate: Date,
  weeks: number,
): LookaheadRow[] {
  const windowEnd = new Date(asOfDate.getTime() + weeks * WEEK_MS);
  const rows: LookaheadRow[] = [];
  for (const a of activities) {
    if (a.type === "summary" || a.type === "project_summary") continue;
    if (!a.isActive) continue;
    const progress = progressByKey.get(a.canonicalActivityKey) ?? defaultProgress();
    const inProgress = progress.status === "in_progress" || (!!progress.actualStart && !progress.actualFinish);
    const startsInWindow = !!a.plannedStart && a.plannedStart >= asOfDate && a.plannedStart <= windowEnd;
    const finishesInWindow = !!a.plannedFinish && a.plannedFinish >= asOfDate && a.plannedFinish <= windowEnd;
    const spansWindow = !!a.plannedStart && !!a.plannedFinish && a.plannedStart <= asOfDate && a.plannedFinish >= asOfDate;
    const pastDueIncomplete = !!a.plannedFinish && a.plannedFinish < asOfDate && progress.status !== "complete";
    if (!(inProgress || startsInWindow || finishesInWindow || spansWindow || pastDueIncomplete)) continue;
    rows.push({
      externalUid: a.externalUid,
      canonicalActivityKey: a.canonicalActivityKey,
      wbsCode: a.wbsCode,
      name: a.name,
      type: a.type,
      plannedStart: a.plannedStart,
      plannedFinish: a.plannedFinish,
      progress,
      slippage: computeSlippage(a, progress, asOfDate),
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lookahead/computeLookahead.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add lib/lookahead/computeLookahead.ts tests/lookahead/computeLookahead.test.ts
git commit -m "feat(lookahead): pure window selection and slippage flags"
```

---

## Task 3: Pure current-progress resolver

**Files:**
- Create: `lib/lookahead/currentProgress.ts`
- Test: `tests/lookahead/currentProgress.test.ts`

**Interfaces:**
- Consumes: `ActivityProgress`, `ProgressStatus` from `@/lib/lookahead/computeLookahead`.
- Produces: type `FinalizedEntry`; function `resolveCurrentProgress(entries: FinalizedEntry[]): Map<string, ActivityProgress>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/lookahead/currentProgress.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveCurrentProgress, type FinalizedEntry } from "@/lib/lookahead/currentProgress";

function entry(p: Partial<FinalizedEntry>): FinalizedEntry {
  return {
    canonicalActivityKey: "1|a", finalizedAt: new Date("2026-06-01T00:00:00Z"),
    status: "in_progress", actualStart: null, actualFinish: null, percentComplete: null, note: null, ...p,
  };
}

describe("resolveCurrentProgress", () => {
  it("keeps the latest finalized entry per key", () => {
    const map = resolveCurrentProgress([
      entry({ finalizedAt: new Date("2026-06-01T00:00:00Z"), percentComplete: 20 }),
      entry({ finalizedAt: new Date("2026-06-08T00:00:00Z"), percentComplete: 60 }),
    ]);
    expect(map.get("1|a")?.percentComplete).toBe(60);
  });
  it("resolves different keys independently", () => {
    const map = resolveCurrentProgress([
      entry({ canonicalActivityKey: "1|a", percentComplete: 10 }),
      entry({ canonicalActivityKey: "2|b", percentComplete: 90 }),
    ]);
    expect(map.get("1|a")?.percentComplete).toBe(10);
    expect(map.get("2|b")?.percentComplete).toBe(90);
  });
  it("returns an empty map for no entries", () => {
    expect(resolveCurrentProgress([]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lookahead/currentProgress.test.ts`
Expected: FAIL — `Cannot find module '@/lib/lookahead/currentProgress'`.

- [ ] **Step 3: Implement the resolver**

Create `lib/lookahead/currentProgress.ts`:

```ts
import type { ActivityProgress, ProgressStatus } from "@/lib/lookahead/computeLookahead";

export interface FinalizedEntry {
  canonicalActivityKey: string;
  finalizedAt: Date;
  status: string;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number | null;
  note: string | null;
}

/** Latest finalized entry per canonicalActivityKey wins. */
export function resolveCurrentProgress(entries: FinalizedEntry[]): Map<string, ActivityProgress> {
  const latest = new Map<string, FinalizedEntry>();
  for (const e of entries) {
    const prev = latest.get(e.canonicalActivityKey);
    if (!prev || e.finalizedAt > prev.finalizedAt) latest.set(e.canonicalActivityKey, e);
  }
  const out = new Map<string, ActivityProgress>();
  for (const [key, e] of latest) {
    out.set(key, {
      status: e.status as ProgressStatus,
      actualStart: e.actualStart,
      actualFinish: e.actualFinish,
      percentComplete: e.percentComplete,
      note: e.note,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lookahead/currentProgress.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/lookahead/currentProgress.ts tests/lookahead/currentProgress.test.ts
git commit -m "feat(lookahead): resolve latest finalized progress per activity key"
```

---

## Task 4: Update service layer (draft lifecycle + persistence)

**Files:**
- Create: `lib/updates/updateService.ts`
- Test: `tests/updates/updateService.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`; `toDbDate` from `@/lib/import/commitImport`; `FinalizedEntry` from `@/lib/lookahead/currentProgress`.
- Produces:
  - type `EntryInput` = `{ activityExternalUid: number; canonicalActivityKey: string; status: string; actualStart: string | null; actualFinish: string | null; percentComplete: number | null; note: string | null }`
  - `getOrCreateDraft(projectId: string, asOfDate: string, lookaheadWeeks: number): Promise<{ id: string }>`
  - `saveEntries(updateId: string, entries: EntryInput[]): Promise<void>`
  - `finalizeUpdate(updateId: string): Promise<void>`
  - `getFinalizedEntries(projectId: string): Promise<FinalizedEntry[]>`

- [ ] **Step 1: Write the failing DB-gated tests**

Create `tests/updates/updateService.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getOrCreateDraft, saveEntries, finalizeUpdate, getFinalizedEntries } from "@/lib/updates/updateService";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("updateService", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("runs the draft -> save -> finalize lifecycle and enforces invariants", async () => {
    const project = await prisma.project.create({ data: { name: "Update Service Test" } });
    projectId = project.id;
    await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h" },
    });

    // one-draft-per-project: two calls return the same id
    const d1 = await getOrCreateDraft(project.id, "2026-06-18", 3);
    const d2 = await getOrCreateDraft(project.id, "2026-06-18", 6);
    expect(d2.id).toBe(d1.id);

    // touched-only: a default not_started entry is dropped, a real one is kept
    await saveEntries(d1.id, [
      { activityExternalUid: 1, canonicalActivityKey: "1|a", status: "in_progress", actualStart: "2026-06-15", actualFinish: null, percentComplete: 40, note: null },
      { activityExternalUid: 2, canonicalActivityKey: "2|b", status: "not_started", actualStart: null, actualFinish: null, percentComplete: null, note: null },
    ]);
    const afterSave = await prisma.progressEntry.findMany({ where: { progressUpdateId: d1.id } });
    expect(afterSave.length).toBe(1);
    expect(afterSave[0].canonicalActivityKey).toBe("1|a");

    // re-saving replaces entries
    await saveEntries(d1.id, [
      { activityExternalUid: 1, canonicalActivityKey: "1|a", status: "complete", actualStart: "2026-06-15", actualFinish: "2026-06-17", percentComplete: 100, note: "done" },
    ]);
    const afterResave = await prisma.progressEntry.findMany({ where: { progressUpdateId: d1.id } });
    expect(afterResave.length).toBe(1);
    expect(afterResave[0].status).toBe("complete");

    // finalize, then both save and re-finalize are rejected
    await finalizeUpdate(d1.id);
    await expect(saveEntries(d1.id, [])).rejects.toThrow();
    await expect(finalizeUpdate(d1.id)).rejects.toThrow();

    // finalized entries are queryable for the overlay
    const finalized = await getFinalizedEntries(project.id);
    expect(finalized.length).toBe(1);
    expect(finalized[0].canonicalActivityKey).toBe("1|a");
    expect(finalized[0].finalizedAt).toBeInstanceOf(Date);

    // a fresh draft can start once the prior is finalized
    const d3 = await getOrCreateDraft(project.id, "2026-06-25", 3);
    expect(d3.id).not.toBe(d1.id);
  });

  it("refuses to start an update when no import exists", async () => {
    const p = await prisma.project.create({ data: { name: "No Import Test" } });
    await expect(getOrCreateDraft(p.id, "2026-06-18", 3)).rejects.toThrow();
    await prisma.project.delete({ where: { id: p.id } });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- tests/updates/updateService.test.ts`
Expected: FAIL — `Cannot find module '@/lib/updates/updateService'` (or `1 skipped` if no `DATABASE_URL`; set one to exercise this task).

- [ ] **Step 3: Implement the service**

Create `lib/updates/updateService.ts`:

```ts
import { prisma } from "@/lib/db";
import { toDbDate } from "@/lib/import/commitImport";
import type { FinalizedEntry } from "@/lib/lookahead/currentProgress";

export interface EntryInput {
  activityExternalUid: number;
  canonicalActivityKey: string;
  status: string;
  actualStart: string | null;
  actualFinish: string | null;
  percentComplete: number | null;
  note: string | null;
}

function isMeaningful(e: EntryInput): boolean {
  return (
    e.status !== "not_started" ||
    !!e.actualStart ||
    !!e.actualFinish ||
    e.percentComplete != null ||
    (e.note?.trim().length ?? 0) > 0
  );
}

/** One draft per project: return the existing draft, else create one against the latest import. */
export async function getOrCreateDraft(projectId: string, asOfDate: string, lookaheadWeeks: number): Promise<{ id: string }> {
  const existing = await prisma.progressUpdate.findFirst({ where: { projectId, state: "draft" } });
  if (existing) return { id: existing.id };
  const latest = await prisma.scheduleImport.findFirst({ where: { projectId }, orderBy: { importedAt: "desc" } });
  if (!latest) throw new Error("Cannot start an update: this project has no schedule import yet.");
  const created = await prisma.progressUpdate.create({
    data: {
      projectId,
      scheduleImportId: latest.id,
      asOfDate: toDbDate(asOfDate) ?? new Date(),
      lookaheadWeeks: lookaheadWeeks === 6 ? 6 : 3,
      state: "draft",
    },
  });
  return { id: created.id };
}

export async function saveEntries(updateId: string, entries: EntryInput[]): Promise<void> {
  const update = await prisma.progressUpdate.findUnique({ where: { id: updateId } });
  if (!update) throw new Error("Update not found.");
  if (update.state !== "draft") throw new Error("This update is finalized and can no longer be edited.");
  const meaningful = entries.filter(isMeaningful);
  await prisma.$transaction(async (tx) => {
    await tx.progressEntry.deleteMany({ where: { progressUpdateId: updateId } });
    if (meaningful.length) {
      await tx.progressEntry.createMany({
        data: meaningful.map((e) => ({
          progressUpdateId: updateId,
          activityExternalUid: e.activityExternalUid,
          canonicalActivityKey: e.canonicalActivityKey,
          status: e.status,
          actualStart: toDbDate(e.actualStart),
          actualFinish: toDbDate(e.actualFinish),
          percentComplete: e.percentComplete,
          note: e.note,
        })),
      });
    }
  });
}

export async function finalizeUpdate(updateId: string): Promise<void> {
  const update = await prisma.progressUpdate.findUnique({ where: { id: updateId } });
  if (!update) throw new Error("Update not found.");
  if (update.state !== "draft") throw new Error("This update is already finalized.");
  await prisma.progressUpdate.update({ where: { id: updateId }, data: { state: "finalized", finalizedAt: new Date() } });
}

export async function getFinalizedEntries(projectId: string): Promise<FinalizedEntry[]> {
  const updates = await prisma.progressUpdate.findMany({
    where: { projectId, state: "finalized" },
    include: { entries: true },
  });
  return updates.flatMap((u) =>
    u.entries.map((e) => ({
      canonicalActivityKey: e.canonicalActivityKey,
      finalizedAt: (u.finalizedAt ?? u.updatedAt) as Date,
      status: e.status,
      actualStart: e.actualStart,
      actualFinish: e.actualFinish,
      percentComplete: e.percentComplete,
      note: e.note,
    })),
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- tests/updates/updateService.test.ts`
Expected: PASS (2 tests) when `DATABASE_URL` is set.

- [ ] **Step 5: Commit**

```bash
git add lib/updates/updateService.ts tests/updates/updateService.test.ts
git commit -m "feat(updates): draft lifecycle, entry persistence, finalized-entry query"
```

---

## Task 5: API route handlers

**Files:**
- Create: `app/api/updates/route.ts`
- Create: `app/api/updates/[updateId]/entries/route.ts`
- Create: `app/api/updates/[updateId]/finalize/route.ts`
- Test: extend `tests/updates/updateService.test.ts` with a route handler test (entries route)

**Interfaces:**
- Consumes: `getOrCreateDraft`, `saveEntries`, `finalizeUpdate`, `EntryInput` from `@/lib/updates/updateService`; `requestBaseUrl` from `@/lib/http`.
- Produces: `POST` handlers. `/api/updates` redirects (303) to the editor; entries + finalize return `{ ok: true }` JSON or `{ error: { message } }` with 422.

- [ ] **Step 1: Write the failing route test**

Append to `tests/updates/updateService.test.ts` (inside the `describe.runIf(hasDb)` block, after the existing tests):

```ts
  it("entries route handler saves via a JSON request", async () => {
    const { POST } = await import("@/app/api/updates/[updateId]/entries/route");
    const project = await prisma.project.create({ data: { name: "Route Test" } });
    await prisma.scheduleImport.create({ data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h" } });
    const draft = await getOrCreateDraft(project.id, "2026-06-18", 3);
    const req = new Request("http://localhost/api/updates/x/entries", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: [{ activityExternalUid: 9, canonicalActivityKey: "9|x", status: "in_progress", actualStart: null, actualFinish: null, percentComplete: 25, note: null }] }),
    });
    const res = await POST(req, { params: { updateId: draft.id } });
    expect(res.status).toBe(200);
    const saved = await prisma.progressEntry.findMany({ where: { progressUpdateId: draft.id } });
    expect(saved.length).toBe(1);
    expect(saved[0].percentComplete).toBe(25);
    await prisma.project.delete({ where: { id: project.id } });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/updates/updateService.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/updates/[updateId]/entries/route'` (or skipped without `DATABASE_URL`).

- [ ] **Step 3: Implement the create/resume draft route**

Create `app/api/updates/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getOrCreateDraft } from "@/lib/updates/updateService";
import { requestBaseUrl } from "@/lib/http";

export async function POST(req: Request) {
  const base = requestBaseUrl(req);
  const form = await req.formData();
  const projectId = String(form.get("projectId") ?? "");
  const asOfDate = String(form.get("asOfDate") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const weeks = Number(form.get("lookaheadWeeks") ?? 3) === 6 ? 6 : 3;
  if (!projectId) return NextResponse.redirect(new URL("/", base), { status: 303 });
  try {
    const { id } = await getOrCreateDraft(projectId, asOfDate, weeks);
    return NextResponse.redirect(new URL(`/projects/${projectId}/updates/${id}`, base), { status: 303 });
  } catch {
    return NextResponse.redirect(new URL(`/projects/${projectId}/updates?error=1`, base), { status: 303 });
  }
}
```

- [ ] **Step 4: Implement the save-entries route**

Create `app/api/updates/[updateId]/entries/route.ts`:

```ts
import { NextResponse } from "next/server";
import { saveEntries, type EntryInput } from "@/lib/updates/updateService";

export async function POST(req: Request, { params }: { params: { updateId: string } }) {
  const body = (await req.json()) as { entries?: EntryInput[] };
  try {
    await saveEntries(params.updateId, body.entries ?? []);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
```

- [ ] **Step 5: Implement the finalize route**

Create `app/api/updates/[updateId]/finalize/route.ts`:

```ts
import { NextResponse } from "next/server";
import { finalizeUpdate } from "@/lib/updates/updateService";

export async function POST(_req: Request, { params }: { params: { updateId: string } }) {
  try {
    await finalizeUpdate(params.updateId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to finalize.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test -- tests/updates/updateService.test.ts`
Expected: PASS (3 tests) when `DATABASE_URL` is set.

- [ ] **Step 7: Commit**

```bash
git add app/api/updates tests/updates/updateService.test.ts
git commit -m "feat(updates): create-draft, save-entries, and finalize API routes"
```

---

## Task 6: Lookahead editor page + client form

**Files:**
- Create: `components/LookaheadUpdateForm.tsx`
- Create: `app/projects/[id]/updates/[updateId]/page.tsx`

**Interfaces:**
- Consumes: `computeLookahead`, `defaultProgress`, types `LookaheadActivity`, `ActivityProgress` from `@/lib/lookahead/computeLookahead`; `resolveCurrentProgress` from `@/lib/lookahead/currentProgress`; `getFinalizedEntries` from `@/lib/updates/updateService`.
- Produces: `LookaheadUpdateForm` client component + exported type `LookaheadFormRow`.

- [ ] **Step 1: Implement the client form component**

Create `components/LookaheadUpdateForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface LookaheadFormRow {
  externalUid: number;
  canonicalActivityKey: string;
  wbsCode: string | null;
  name: string;
  type: string;
  plannedStart: string | null;
  plannedFinish: string | null;
  slippage: "overdue" | "should-have-started" | "on-track";
  status: "not_started" | "in_progress" | "complete";
  actualStart: string;
  actualFinish: string;
  percentComplete: number | null;
  note: string;
}

const slipClass: Record<LookaheadFormRow["slippage"], string> = {
  overdue: "text-red-700",
  "should-have-started": "text-amber-700",
  "on-track": "text-slate-400",
};

export function LookaheadUpdateForm({
  updateId, projectId, rows, readOnly,
}: { updateId: string; projectId: string; rows: LookaheadFormRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [data, setData] = useState(rows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(i: number, p: Partial<LookaheadFormRow>) {
    setData((d) => d.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  }

  async function save(finalize: boolean) {
    setBusy(true);
    setError(null);
    const entries = data.map((r) => ({
      activityExternalUid: r.externalUid,
      canonicalActivityKey: r.canonicalActivityKey,
      status: r.status,
      actualStart: r.actualStart || null,
      actualFinish: r.actualFinish || null,
      percentComplete: r.percentComplete,
      note: r.note || null,
    }));
    const res = await fetch(`/api/updates/${updateId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    if (!res.ok) { setError("Failed to save."); setBusy(false); return; }
    if (finalize) {
      const fin = await fetch(`/api/updates/${updateId}/finalize`, { method: "POST" });
      if (!fin.ok) { setError("Failed to finalize."); setBusy(false); return; }
    }
    setBusy(false);
    if (finalize) router.push(`/projects/${projectId}/updates`);
    else router.refresh();
  }

  return (
    <div>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {data.map((r, i) => (
          <li key={r.externalUid} className="px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <span>
                <span className="mr-2 text-xs text-slate-400">{r.wbsCode}</span>
                <span className="font-medium">{r.name}</span>
                {r.type === "milestone" && <span className="ml-2 text-xs text-indigo-600">◆</span>}
              </span>
              <span className="whitespace-nowrap text-xs text-slate-500">{r.plannedStart ?? "—"} → {r.plannedFinish ?? "—"}</span>
            </div>
            <div className={`mt-1 text-xs ${slipClass[r.slippage]}`}>{r.slippage}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <select disabled={readOnly} value={r.status} onChange={(e) => patch(i, { status: e.target.value as LookaheadFormRow["status"] })} className="rounded border border-slate-300 px-2 py-1 text-sm" aria-label="Status">
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="complete">Complete</option>
              </select>
              <input disabled={readOnly} type="date" value={r.actualStart} onChange={(e) => patch(i, { actualStart: e.target.value })} className="rounded border border-slate-300 px-2 py-1 text-sm" aria-label="Actual start" />
              <input disabled={readOnly} type="date" value={r.actualFinish} onChange={(e) => patch(i, { actualFinish: e.target.value })} className="rounded border border-slate-300 px-2 py-1 text-sm" aria-label="Actual finish" />
              <input disabled={readOnly} type="number" min={0} max={100} value={r.percentComplete ?? ""} onChange={(e) => patch(i, { percentComplete: e.target.value === "" ? null : Number(e.target.value) })} placeholder="% complete" className="rounded border border-slate-300 px-2 py-1 text-sm" aria-label="Percent complete" />
            </div>
            <input disabled={readOnly} value={r.note} onChange={(e) => patch(i, { note: e.target.value })} placeholder="Note (optional)" className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={() => save(false)} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">Save draft</button>
          <button disabled={busy} onClick={() => save(true)} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">Finalize</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement the editor page**

Create `app/projects/[id]/updates/[updateId]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { computeLookahead, type LookaheadActivity, type ActivityProgress } from "@/lib/lookahead/computeLookahead";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { LookaheadUpdateForm, type LookaheadFormRow } from "@/components/LookaheadUpdateForm";

export const dynamic = "force-dynamic";

function isoDay(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function UpdateEditorPage({ params }: { params: { id: string; updateId: string } }) {
  const update = await prisma.progressUpdate.findUnique({
    where: { id: params.updateId },
    include: { entries: true, scheduleImport: { include: { activities: true } } },
  });
  if (!update || update.projectId !== params.id) notFound();

  const activities: LookaheadActivity[] = update.scheduleImport.activities.map((a) => ({
    externalUid: a.externalUid,
    canonicalActivityKey: a.canonicalActivityKey,
    wbsCode: a.wbsCode,
    name: a.name,
    type: a.type,
    isActive: a.isActive,
    plannedStart: a.plannedStart,
    plannedFinish: a.plannedFinish,
  }));

  // Effective progress = carry-forward from finalized updates, overridden by this draft's own entries.
  const carry = resolveCurrentProgress(await getFinalizedEntries(params.id));
  const effective = new Map<string, ActivityProgress>(carry);
  for (const e of update.entries) {
    effective.set(e.canonicalActivityKey, {
      status: e.status as ActivityProgress["status"],
      actualStart: e.actualStart,
      actualFinish: e.actualFinish,
      percentComplete: e.percentComplete,
      note: e.note,
    });
  }

  const lookahead = computeLookahead(activities, effective, update.asOfDate, update.lookaheadWeeks);
  const rows: LookaheadFormRow[] = lookahead.map((r) => ({
    externalUid: r.externalUid,
    canonicalActivityKey: r.canonicalActivityKey,
    wbsCode: r.wbsCode,
    name: r.name,
    type: r.type,
    plannedStart: isoDay(r.plannedStart) || null,
    plannedFinish: isoDay(r.plannedFinish) || null,
    slippage: r.slippage,
    status: r.progress.status,
    actualStart: isoDay(r.progress.actualStart),
    actualFinish: isoDay(r.progress.actualFinish),
    percentComplete: r.progress.percentComplete,
    note: r.progress.note ?? "",
  }));

  const finalized = update.state === "finalized";
  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link href={`/projects/${params.id}/updates`} className="text-sm text-slate-500">← Updates</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Weekly update — {isoDay(update.asOfDate)}</h1>
      <p className="mb-4 text-sm text-slate-500">
        {update.lookaheadWeeks}-week lookahead · {finalized ? "finalized" : "draft"} · {rows.length} activities
      </p>
      <LookaheadUpdateForm updateId={update.id} projectId={params.id} rows={rows} readOnly={finalized} />
    </main>
  );
}
```

- [ ] **Step 3: Build to verify the page and component type-check and compile**

Run: `npm run build`
Expected: BUILD succeeds (exit 0); route `/projects/[id]/updates/[updateId]` appears in the build output.

- [ ] **Step 4: Commit**

```bash
git add app/projects/[id]/updates/[updateId]/page.tsx components/LookaheadUpdateForm.tsx
git commit -m "feat(updates): lookahead editor page and progress form"
```

---

## Task 7: Update history page + start-update form + nav entry point

**Files:**
- Create: `app/projects/[id]/updates/page.tsx`
- Modify: `app/projects/[id]/page.tsx` (add nav link, ~line 45)

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`. Posts to `POST /api/updates` (Task 5).

- [ ] **Step 1: Implement the history + start-update page**

Create `app/projects/[id]/updates/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function UpdatesPage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const latest = await prisma.scheduleImport.findFirst({ where: { projectId: project.id }, orderBy: { importedAt: "desc" } });
  const updates = await prisma.progressUpdate.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { entries: true } } },
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-4 mt-1 text-xl font-semibold">Weekly updates</h1>

      {!latest ? (
        <p className="text-slate-500">Import a schedule before starting weekly updates.</p>
      ) : (
        <form action="/api/updates" method="post" className="mb-6 flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-3">
          <input type="hidden" name="projectId" value={project.id} />
          <label className="text-sm">As-of date
            <input type="date" name="asOfDate" defaultValue={today} className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-sm">Lookahead
            <select name="lookaheadWeeks" defaultValue="3" className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="3">3 weeks</option>
              <option value="6">6 weeks</option>
            </select>
          </label>
          <button className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">New update</button>
        </form>
      )}

      {updates.length === 0 ? (
        <p className="text-slate-500">No updates yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {updates.map((u) => (
            <li key={u.id}>
              <Link href={`/projects/${project.id}/updates/${u.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <span className="font-medium">{u.asOfDate.toISOString().slice(0, 10)} · {u.lookaheadWeeks}wk</span>
                <span className="text-sm text-slate-500">{u.state} · {u._count.entries} entries</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Add the nav link to the verification view**

In `app/projects/[id]/page.tsx`, replace the single import-link block (around lines 45-47):

```tsx
        <Link href={`/projects/${project.id}/import`} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">
          Import schedule
        </Link>
```

with a two-link cluster:

```tsx
        <div className="flex gap-2">
          <Link href={`/projects/${project.id}/updates`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Weekly updates
          </Link>
          <Link href={`/projects/${project.id}/import`} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            Import schedule
          </Link>
        </div>
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: BUILD succeeds; route `/projects/[id]/updates` appears in output.

- [ ] **Step 4: Commit**

```bash
git add app/projects/[id]/updates/page.tsx app/projects/[id]/page.tsx
git commit -m "feat(updates): update history, start-update form, and project nav link"
```

---

## Task 8: Overlay current progress into the verification view

**Files:**
- Modify: `app/projects/[id]/page.tsx`

**Interfaces:**
- Consumes: `resolveCurrentProgress` from `@/lib/lookahead/currentProgress`; `getFinalizedEntries` from `@/lib/updates/updateService`.

- [ ] **Step 1: Import the resolver and query**

In `app/projects/[id]/page.tsx`, add after the existing imports:

```tsx
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";
```

- [ ] **Step 2: Build the current-progress map and overlay percent complete**

After the `latest` query and before building `rows`, add:

```tsx
  const currentProgress = resolveCurrentProgress(await getFinalizedEntries(project.id));
```

Then in the `rows` mapping, change the `percentComplete` line from:

```tsx
    percentComplete: a.percentComplete,
```

to overlay the latest finalized value when present:

```tsx
    percentComplete: currentProgress.get(a.canonicalActivityKey)?.percentComplete ?? a.percentComplete,
```

- [ ] **Step 3: Build to verify the overlay compiles**

Run: `npm run build`
Expected: BUILD succeeds (exit 0).

- [ ] **Step 4: Full test + build gate before review**

Run: `npm run test && npm run build`
Expected: tests PASS (unit tests always; DB-gated pass when `DATABASE_URL` is set, otherwise skipped); BUILD exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/projects/[id]/page.tsx
git commit -m "feat(updates): reflect latest finalized progress in the verification view"
```

---

## Manual Smoke Test (after Task 8, against a deployed or local DB)

1. Log in. Open a project that has an imported schedule.
2. Click **Weekly updates** → set as-of date + 3 weeks → **New update**.
3. Confirm the editor shows near-term + overdue activities with slippage tags.
4. Mark one activity in-progress with a % and an actual start; **Save draft**; reload — values persist.
5. Re-open via **Weekly updates** → the same draft resumes (no second draft created).
6. **Finalize** → redirected to history; the update shows `finalized`. Re-opening it is read-only.
7. Back on the project page, the finalized % complete shows on the matching activity.
8. Start another update → its editor pre-fills the carried-forward progress.

---

## Self-Review

- **Spec coverage:** §4 data model → Task 1. §5.1 overlay → Tasks 3, 6, 8. §5.2 inclusion + §5.3 slippage → Task 2. §5.4 re-import lineage (carry-forward by exact key) → Tasks 3, 4, 6. §6 flow/routes/components + one-draft rule + immutability → Tasks 4–7. §7 telemetry → opt-out, no code. §8 testing tiers → unit (Tasks 2,3), DB-gated (Tasks 1,4,5), smoke (manual section). Non-goals respected: no CPM recompute, no structure edits, exact-key only, single save POST, shared login.
- **Placeholder scan:** none — every code step contains full code.
- **Type consistency:** `ActivityProgress`/`ProgressStatus`/`SlippageFlag` defined in Task 2 and reused in Tasks 3/6; `EntryInput` defined in Task 4 and consumed in Task 5; `LookaheadFormRow` defined in Task 6 and consumed by its page; `getFinalizedEntries` returns `FinalizedEntry[]` consumed by `resolveCurrentProgress`. Status/slippage literals match the Global Constraints.
```
