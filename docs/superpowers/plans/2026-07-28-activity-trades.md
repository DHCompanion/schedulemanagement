# Activity Trades, Round-Trip Drift, and Batch Splits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each activity's discipline and trade partner in the schedule view, carry both into the exported MS Project file and flag what comes back changed, and make one split accept apply to every identical coarse activity.

**Architecture:** Trade data stays derived, never stored on the activity — `name → scope → discipline → partner` resolved at read time from three existing loaders. The export writes the two values as MSPDI extended attributes; the importer already parses those into `Activity.customFields` keyed by alias, so drift is a read-time comparison with no snapshot table. Batch splits reuse the existing single-split machinery inside one transaction, which requires relaxing a unique constraint.

**Tech Stack:** Next.js 15 (App Router, RSC), React 19, TypeScript strict, Prisma 5 + PostgreSQL (Neon), Vitest 4, Tailwind.

## Global Constraints

- TypeScript strict. Never use `any` to silence an error.
- No `console.log` in server-side code.
- Core OS owns Projects, Tasks, Wiki — never write those tables from this tool.
- New tables follow `docs/architecture/FORWARD_COMPATIBILITY.md`: portable ids (`cuid`), generic actor shape (`dismissedBy` string + `personId` int), no local project-number minting.
- Commit schema changes and their generated migration together in one commit.
- Extended-attribute aliases are the round-trip contract: exactly `"Discipline"` and `"Trade Partner"`. Do not rename.
- One trade partner per discipline per project. Do not add per-activity partner storage.
- Run `npm run build` and `npm run test` before any review.
- DB-gated tests use `describe.runIf(hasDb)` with `const hasDb = !!process.env.DATABASE_URL` and a `30000` ms timeout.
- Import alias is `@/` for repo root.

---

## File Structure

**Group A — batch splits (shippable alone)**
- Modify `prisma/schema.prisma` — relax `CompletenessSplit.resultScheduleImportId`
- Modify `lib/completeness/acceptSplit.ts` — batch across matching activities; `resolveExportBase` reads many
- Modify `app/api/completeness/accept/route.ts` — takes `coarseScope`, not one activity key
- Modify `components/CompletenessIssuesTable.tsx` — confirm dialog states blast radius

**Group B — trade on the activity row**
- Create `lib/trades/activityTrades.ts` — `resolveActivityTradesWith` (pure) + `resolveActivityTrades` (loads)
- Modify `app/projects/[id]/page.tsx` — resolve once, pass onto rows
- Modify `components/ActivityTable.tsx` — detail fields, search, discipline filter

**Group C — round-trip and drift**
- Create `lib/export/injectTrades.ts` — write definitions + task values
- Modify `lib/export/buildExport.ts` — call it
- Create `lib/trades/tradeDrift.ts` — pure comparison
- Modify `prisma/schema.prisma` — add `TradeDriftDismissal`
- Create `app/api/trades/drift/route.ts` — accept-file / keep-tools
- Modify `components/TradesPanel.tsx` — fourth tab
- Modify `app/projects/[id]/trades/page.tsx` — load drift rows

Tasks 1–4 deliver batch splits and can ship without the rest.

---

### Task 1: Allow many splits per synthetic import

`CompletenessSplit.resultScheduleImportId` is `@unique`, hard-coding one split per synthetic import. A batch needs N rows sharing one result import. The back-relations on `Project` and `ScheduleImport` are already `CompletenessSplit[]`, so only the field changes.

**Files:**
- Modify: `prisma/schema.prisma:325` (the `resultScheduleImportId` line) and the model's index block
- Modify: `lib/completeness/acceptSplit.ts` (`resolveExportBase`, bottom of file)
- Test: `tests/completeness/acceptSplit.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `resolveExportBase(latestImportId: string): Promise<{ baseImport: ScheduleImport; splits: CompletenessSplit[] }>` — unchanged signature, now collects every split per synthetic import

- [ ] **Step 1: Write the failing test**

Add to `tests/completeness/acceptSplit.test.ts`, inside the existing `describe.runIf(hasDb)` block:

```ts
it("collects every split recorded against one synthetic import", async () => {
  const project = await prisma.project.create({ data: { name: "Multi Split Base" } });
  const base = await prisma.scheduleImport.create({
    data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "b.xml", fileHash: `h-${project.id}` },
  });
  const synthetic = await prisma.scheduleImport.create({
    data: {
      projectId: project.id, sourceFormat: "msproject_xml", fileName: "b.xml", fileHash: `h-${project.id}`,
      isSynthetic: true, derivedFromImportId: base.id,
    },
  });
  for (const [i, name] of ["Coarse A", "Coarse B"].entries()) {
    await prisma.completenessSplit.create({
      data: {
        projectId: project.id, sourceScheduleImportId: base.id, resultScheduleImportId: synthetic.id,
        coarseExternalUid: 100 + i, coarseName: name, finerScopes: ["X", "Y"], mintedUids: [200 + i * 2, 201 + i * 2],
      },
    });
  }

  const { baseImport, splits } = await resolveExportBase(synthetic.id);
  expect(baseImport.id).toBe(base.id);
  expect(splits).toHaveLength(2);
  expect(splits.map((s) => s.coarseName).sort()).toEqual(["Coarse A", "Coarse B"]);

  await prisma.project.delete({ where: { id: project.id } });
}, 30000);
```

Confirm `resolveExportBase` is in that file's imports; add it to the existing import from `@/lib/completeness/acceptSplit` if not.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/completeness/acceptSplit.test.ts -t "collects every split"`
Expected: FAIL — the second `completenessSplit.create` violates the unique constraint on `resultScheduleImportId`.

- [ ] **Step 3: Relax the constraint**

In `prisma/schema.prisma`, model `CompletenessSplit`, change:

```prisma
  resultScheduleImportId String   @unique             // the synthetic import this created
```

to:

```prisma
  resultScheduleImportId String                       // the synthetic import this created
```

and add to the model's index block, next to `@@index([projectId])`:

```prisma
  @@index([resultScheduleImportId])
```

- [ ] **Step 4: Generate the migration**

Run: `npx prisma migrate dev --name allow_many_splits_per_import`
Expected: a new folder under `prisma/migrations/` dropping the unique index and creating a plain one.

- [ ] **Step 5: Make resolveExportBase read many**

In `lib/completeness/acceptSplit.ts`, in `resolveExportBase`, replace:

```ts
    const split = await prisma.completenessSplit.findUnique({ where: { resultScheduleImportId: current.id } });
    if (!split) break;
    splits.unshift(split);
```

with:

```ts
    // Many splits can share one synthetic import — a batch accept records one
    // row per coarse activity it replaced. Ordered so the export applies them
    // deterministically.
    const batch = await prisma.completenessSplit.findMany({
      where: { resultScheduleImportId: current.id },
      orderBy: { coarseExternalUid: "asc" },
    });
    if (batch.length === 0) break;
    splits.unshift(...batch);
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/completeness/acceptSplit.test.ts`
Expected: PASS, including the pre-existing single-split and export tests.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/completeness/acceptSplit.ts tests/completeness/acceptSplit.test.ts
git commit -m "refactor(completeness): let one synthetic import carry many splits

A batch accept replaces every identical coarse activity at once, which means N
split records against one result import. The unique constraint allowed exactly
one, so it becomes a plain index and the export walk collects the batch."
```

---

### Task 2: Batch acceptSplit across every flagged instance

**Files:**
- Modify: `lib/completeness/acceptSplit.ts` (the `acceptSplit` function)
- Test: `tests/completeness/acceptSplit.test.ts`

**Interfaces:**
- Consumes: `resolveExportBase` from Task 1; `getCompleteness` from `@/lib/completeness/completenessService`
- Produces: `acceptSplit(projectId: string, coarseScope: string, acceptedBy?: string, personId?: number | null): Promise<{ newImportId: string; splitCount: number }>` — note the second parameter is now the coarse scope, not `canonicalActivityKey`, and the result carries `splitCount`

- [ ] **Step 1: Write the failing test**

```ts
it("splits every flagged instance in one import and leaves dismissed ones alone", async () => {
  const coarse = `ZZ Batch ${Date.now()}`;
  await prisma.scopeSplitRule.createMany({
    data: [{ coarseScope: coarse, finerScope: "Part A" }, { coarseScope: coarse, finerScope: "Part B" }],
  });
  const project = await prisma.project.create({ data: { name: "Batch Split Test" } });
  const imp = await prisma.scheduleImport.create({
    data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "b.xml", fileHash: `h-${project.id}` },
  });
  for (let i = 1; i <= 3; i += 1) {
    await prisma.activity.create({
      data: {
        scheduleImportId: imp.id, externalUid: i, externalId: i, wbsCode: `1.${i}`,
        name: coarse, canonicalActivityKey: `1.${i}|${coarse.toLowerCase()}`, type: "task",
      },
    });
  }
  await prisma.completenessDismissal.create({
    data: { projectId: project.id, canonicalActivityKey: `1.3|${coarse.toLowerCase()}`, coarseScope: coarse },
  });

  const { newImportId, splitCount } = await acceptSplit(project.id, coarse);
  expect(splitCount).toBe(2);

  const splits = await prisma.completenessSplit.findMany({ where: { resultScheduleImportId: newImportId } });
  expect(splits).toHaveLength(2);

  const result = await prisma.activity.findMany({ where: { scheduleImportId: newImportId } });
  expect(result.filter((a) => a.name === "Part A")).toHaveLength(2);
  expect(result.filter((a) => a.name === "Part B")).toHaveLength(2);
  // The dismissed instance survives untouched.
  expect(result.filter((a) => a.name === coarse)).toHaveLength(1);
  // Minted UIDs never collide.
  expect(new Set(result.map((a) => a.externalUid)).size).toBe(result.length);

  await prisma.scopeSplitRule.deleteMany({ where: { coarseScope: coarse } });
  await prisma.project.delete({ where: { id: project.id } });
}, 30000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/completeness/acceptSplit.test.ts -t "splits every flagged instance"`
Expected: FAIL — `acceptSplit` still expects a `canonicalActivityKey` as its second argument.

- [ ] **Step 3: Rewrite acceptSplit to batch**

In `lib/completeness/acceptSplit.ts`, add the import:

```ts
import { getCompleteness } from "@/lib/completeness/completenessService";
```

Replace the signature and the lookup of the single coarse activity:

```ts
export async function acceptSplit(
  projectId: string,
  coarseScope: string,
  acceptedBy?: string,
  personId?: number | null,
): Promise<{ newImportId: string; splitCount: number }> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true, relationships: true },
  });
  if (!latest) throw new Error("No imported schedule to split.");

  const splitRules = await getSplitRules();
  const finerScopes = splitRules.get(coarseScope);
  if (!finerScopes || finerScopes.length === 0) throw new Error("No split rule found for this coarse scope.");

  // Reuse the completeness read so dismissals are honoured by exactly the rule
  // that flagged these in the first place — a second copy of that filter here
  // would drift from it.
  const { issues } = await getCompleteness(projectId);
  const targetKeys = new Set(issues.filter((i) => i.coarseScope === coarseScope).map((i) => i.canonicalActivityKey));
  const coarseActivities = latest.activities.filter((a) => targetKeys.has(a.canonicalActivityKey));
  if (coarseActivities.length === 0) throw new Error("Nothing left to split for this coarse scope.");

  const coarseIds = new Set(coarseActivities.map((a) => a.id));
  const coarseUids = new Set(coarseActivities.map((a) => a.externalUid));

  const { _max } = await prisma.activity.aggregate({
    where: { scheduleImport: { projectId } },
    _max: { externalUid: true },
  });
  let nextUid = (_max.externalUid ?? 0) + 1;
  const mintedByActivityId = new Map<string, number[]>();
  for (const coarse of coarseActivities) {
    mintedByActivityId.set(coarse.id, finerScopes.map(() => nextUid++));
  }
```

Then, inside the transaction, replace the single-activity body. `otherActivities` and `otherRelationships` exclude every coarse activity:

```ts
    const otherActivities = latest.activities.filter((a) => !coarseIds.has(a.id));
```

```ts
    const otherRelationships = latest.relationships.filter(
      (r) => !coarseUids.has(r.predecessorExternalUid) && !coarseUids.has(r.successorExternalUid),
    );
```

> **Correction (applied in commit `e0ceafe`).** The `fanned` construction below
> is WRONG and must not be copied verbatim. Fanning per coarse activity breaks
> when both ends of a relationship are coarse activities *in the same batch*:
> each loop re-points only one end, leaving rows that reference the replaced
> activities. Build `fanned` with a single pass over `latest.relationships`
> instead, keyed by a `mintedUidsByExternalUid` map: both ends minted → emit the
> cross-product; one end minted → fan that end only; neither → skip (already
> covered by `otherRelationships`). One pass means each relationship is emitted
> exactly once. See `lib/completeness/acceptSplit.ts` for the shipped version.

The finer-task creation, relationship fan-out and split record now loop over every coarse activity. Replace the single `tx.activity.createMany` for finer scopes, the `fanned` construction, and the single `tx.completenessSplit.create` with:

```ts
    const finerRows: Prisma.ActivityCreateManyInput[] = [];
    const fanned: Prisma.RelationshipCreateManyInput[] = [];
    const splitRows: Prisma.CompletenessSplitCreateManyInput[] = [];

    for (const coarse of coarseActivities) {
      const mintedUids = mintedByActivityId.get(coarse.id)!;

      finerRows.push(
        ...finerScopes.map((scope, i) => {
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
      );

      for (const r of latest.relationships.filter((r) => r.predecessorExternalUid === coarse.externalUid)) {
        for (const uid of mintedUids) {
          fanned.push({
            scheduleImportId: created.id,
            predecessorExternalUid: uid,
            successorExternalUid: r.successorExternalUid,
            type: r.type, rawType: r.rawType, lagMinutes: r.lagMinutes,
            rawLagFormat: r.rawLagFormat, crossProject: r.crossProject,
          });
        }
      }
      for (const r of latest.relationships.filter((r) => r.successorExternalUid === coarse.externalUid)) {
        for (const uid of mintedUids) {
          fanned.push({
            scheduleImportId: created.id,
            predecessorExternalUid: r.predecessorExternalUid,
            successorExternalUid: uid,
            type: r.type, rawType: r.rawType, lagMinutes: r.lagMinutes,
            rawLagFormat: r.rawLagFormat, crossProject: r.crossProject,
          });
        }
      }

      splitRows.push({
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
        personId: personId ?? null,
      });
    }

    await tx.activity.createMany({ data: finerRows });
    if (fanned.length) await tx.relationship.createMany({ data: fanned });
    await tx.completenessSplit.createMany({ data: splitRows });
```

Update the import's `notes` and counts accordingly:

```ts
        notes: `Split ${coarseActivities.length} × "${coarseScope}" into: ${finerScopes.join(", ")}`,
```

```ts
      data: {
        activityCount: otherActivities.length + finerRows.length,
        relationshipCount: otherRelationships.length + fanned.length,
      },
```

and return both values:

```ts
  return { newImportId, splitCount: coarseActivities.length };
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/completeness/acceptSplit.test.ts`
Expected: PASS. The existing single-instance test still passes — one flagged instance is a batch of one — but its call must be updated to the new signature (drop the `canonicalActivityKey` argument).

- [ ] **Step 5: Commit**

```bash
git add lib/completeness/acceptSplit.ts tests/completeness/acceptSplit.test.ts
git commit -m "feat(completeness): accept a split once, apply it to every identical activity

Accepting eight instances of one coarse scope stacked eight synthetic imports
and eight clicks. It now resolves every flagged instance of that scope and
replaces them in a single import. Dismissals are honoured by reusing the
completeness read rather than reimplementing its filter."
```

---

### Task 3: Point the accept route and table at the coarse scope

**Files:**
- Modify: `app/api/completeness/accept/route.ts`
- Modify: `components/CompletenessIssuesTable.tsx:53-70` (the `accept` function)
- Test: `tests/completeness/acceptSplit.test.ts` (the existing route test)

**Interfaces:**
- Consumes: `acceptSplit(projectId, coarseScope, acceptedBy?, personId?)` from Task 2
- Produces: `POST /api/completeness/accept` accepting `{ projectId, coarseScope, acceptedBy? }` and returning `{ ok: true, newImportId, splitCount }`

- [ ] **Step 1: Update the route**

In `app/api/completeness/accept/route.ts`, drop `canonicalActivityKey` from `AcceptBody` and its validation, and pass the scope:

```ts
interface AcceptBody {
  projectId?: string;
  coarseScope?: string;
  acceptedBy?: string;
}
```

```ts
  if (!body.projectId || !body.coarseScope) {
    return NextResponse.json(
      { error: { message: "projectId and coarseScope are required." } },
      { status: 422 },
    );
  }
```

```ts
    const { newImportId, splitCount } = await acceptSplit(
      body.projectId,
      body.coarseScope,
      body.acceptedBy,
      scope?.personId,
    );
    return NextResponse.json({ ok: true, newImportId, splitCount });
```

- [ ] **Step 2: Update the confirm dialog to state the blast radius**

In `components/CompletenessIssuesTable.tsx`, replace the body of `accept` down to the `fetch` call:

```ts
  async function accept(issue: CompletenessIssue) {
    const key = `${issue.canonicalActivityKey}::${issue.coarseScope}`;
    const matching = issues.filter((i) => i.coarseScope === issue.coarseScope).length;
    const confirmed = window.confirm(
      `Replace ${matching} activit${matching === 1 ? "y" : "ies"} named "${issue.coarseScope}" with ` +
        `${issue.finerScopes.length} parallel activities each — ${issue.finerScopes.join(", ")} — ` +
        `${matching * issue.finerScopes.length} tasks in total, each inheriting its predecessors, ` +
        `successors, and duration. Activities you dismissed are left alone. Continue?`,
    );
    if (!confirmed) return;
    setBusyKey(key);
    setError(null);
    const res = await fetch(appPath("/api/completeness/accept"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, coarseScope: issue.coarseScope }),
    });
```

Leave the rest of the function unchanged.

- [ ] **Step 3: Update the existing route test**

In `tests/completeness/acceptSplit.test.ts`, the route test posts `canonicalActivityKey`. Change its body to `{ projectId: pid, coarseScope: coarse }` and assert `splitCount` is returned:

```ts
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.splitCount).toBeGreaterThan(0);
```

- [ ] **Step 4: Verify**

Run: `npm run test && npm run build`
Expected: all tests pass, build compiles.

- [ ] **Step 5: Commit**

```bash
git add app/api/completeness/accept/route.ts components/CompletenessIssuesTable.tsx tests/completeness/acceptSplit.test.ts
git commit -m "feat(completeness): accept by coarse scope and say how much it will change

The confirm dialog now names the number of activities and resulting tasks,
because one click is no longer one row."
```

---

### Task 4: Resolve an activity's discipline and partner

**Files:**
- Create: `lib/trades/activityTrades.ts`
- Test: `tests/trades/activityTrades.test.ts`

**Interfaces:**
- Consumes: `getDictionary` from `@/lib/normalize/normalizationService`, `getTradeDictionary` and `getProjectAssignments` from `@/lib/trades/tradesService`, `normalizeName` from `@/lib/normalize/normalizeName`
- Produces:
  - `type ActivityTrade = { disciplineName: string; partnerName: string | null }`
  - `resolveActivityTradesWith(activities, scopeDict, tradeDict, assignments): Map<string, ActivityTrade>` — pure, no DB
  - `resolveActivityTrades(projectId, activities): Promise<Map<string, ActivityTrade>>` — loads then delegates

The pure/loading split mirrors `applyDictionaryWith` / `applyDictionary` already in this codebase, and is what makes the unit tests DB-free.

- [ ] **Step 1: Write the failing test**

Create `tests/trades/activityTrades.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveActivityTradesWith } from "@/lib/trades/activityTrades";
import type { OsDiscipline, ProjectAssignment } from "@/lib/trades/tradesService";

const scopeDict = new Map([["hang drywall l2", "Hang Drywall"]]);
const tradeDict = new Map<string, OsDiscipline>([
  ["Hang Drywall", { id: 9, name: "09A: DRYWALL/ACOUSTICAL", division: "" }],
]);
const assignments = new Map<number, ProjectAssignment>([
  [9, { osPartnerId: 4, name: "Carrco Painting Contractors, Inc.", onRoster: true }],
]);

describe("resolveActivityTradesWith", () => {
  it("resolves name to discipline and partner", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "Hang Drywall L2" }], scopeDict, tradeDict, assignments);
    expect(out.get("a1")).toEqual({
      disciplineName: "09A: DRYWALL/ACOUSTICAL",
      partnerName: "Carrco Painting Contractors, Inc.",
    });
  });

  it("omits an activity whose name is not in the scope dictionary", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "Mystery Task" }], scopeDict, tradeDict, assignments);
    expect(out.has("a1")).toBe(false);
  });

  it("omits an activity whose scope has no discipline", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "Hang Drywall L2" }], scopeDict, new Map(), assignments);
    expect(out.has("a1")).toBe(false);
  });

  it("returns the discipline with a null partner when none is assigned", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "Hang Drywall L2" }], scopeDict, tradeDict, new Map());
    expect(out.get("a1")).toEqual({ disciplineName: "09A: DRYWALL/ACOUSTICAL", partnerName: null });
  });

  it("matches names case- and whitespace-insensitively", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "  HANG   drywall l2 " }], scopeDict, tradeDict, assignments);
    expect(out.get("a1")?.partnerName).toBe("Carrco Painting Contractors, Inc.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/trades/activityTrades.test.ts`
Expected: FAIL — cannot resolve `@/lib/trades/activityTrades`.

- [ ] **Step 3: Implement**

Create `lib/trades/activityTrades.ts`:

```ts
import { normalizeName } from "@/lib/normalize/normalizeName";
import { getDictionary } from "@/lib/normalize/normalizationService";
import {
  getProjectAssignments,
  getTradeDictionary,
  type OsDiscipline,
  type ProjectAssignment,
} from "@/lib/trades/tradesService";

export type ActivityTrade = { disciplineName: string; partnerName: string | null };

export interface NamedActivity {
  id: string;
  name: string;
}

/**
 * Who is doing this activity, derived rather than stored:
 *   name -> canonical scope -> OS discipline -> the partner assigned to it.
 *
 * An activity missing from the result is a normal state, not an error — its
 * name may be unmapped, or its scope may have no discipline yet. A discipline
 * with no assigned partner still resolves, with a null partner, because the
 * discipline alone is worth showing.
 */
export function resolveActivityTradesWith(
  activities: NamedActivity[],
  scopeDict: Map<string, string>,
  tradeDict: Map<string, OsDiscipline>,
  assignments: Map<number, ProjectAssignment>,
): Map<string, ActivityTrade> {
  const out = new Map<string, ActivityTrade>();
  for (const activity of activities) {
    const scope = scopeDict.get(normalizeName(activity.name));
    if (!scope) continue;
    const discipline = tradeDict.get(scope);
    if (!discipline) continue;
    out.set(activity.id, {
      disciplineName: discipline.name,
      partnerName: assignments.get(discipline.id)?.name ?? null,
    });
  }
  return out;
}

/** Three queries regardless of activity count. */
export async function resolveActivityTrades(
  projectId: string,
  activities: NamedActivity[],
): Promise<Map<string, ActivityTrade>> {
  const [scopeDict, tradeDict, assignments] = await Promise.all([
    getDictionary(),
    getTradeDictionary(),
    getProjectAssignments(projectId),
  ]);
  return resolveActivityTradesWith(activities, scopeDict, tradeDict, assignments);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/trades/activityTrades.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/trades/activityTrades.ts tests/trades/activityTrades.test.ts
git commit -m "feat(trades): resolve an activity's discipline and partner

Derived at read time from the three existing loaders rather than stored on the
activity, so a reassignment is reflected everywhere at once instead of leaving
stale copies behind."
```

---

### Task 5: Show, search and filter trade on the schedule view

**Files:**
- Modify: `app/projects/[id]/page.tsx`
- Modify: `components/ActivityTable.tsx`

**Interfaces:**
- Consumes: `resolveActivityTrades` from Task 4
- Produces: `ActivityRow` gains `disciplineName: string | null` and `partnerName: string | null`

- [ ] **Step 1: Resolve on the page**

In `app/projects/[id]/page.tsx`, add the import:

```ts
import { resolveActivityTrades } from "@/lib/trades/activityTrades";
```

After `const scopeDict = await getDictionary();`, add:

```ts
  const trades = await resolveActivityTrades(
    project.id,
    (latest?.activities ?? []).map((a) => ({ id: a.id, name: a.name })),
  );
```

and in the `rows` mapping, after the `canonicalScope` line:

```ts
    disciplineName: trades.get(a.id)?.disciplineName ?? null,
    partnerName: trades.get(a.id)?.partnerName ?? null,
```

- [ ] **Step 2: Extend the row type and search**

In `components/ActivityTable.tsx`, add to `ActivityRow` after `canonicalScope`:

```ts
  /** Derived from the scope dictionary and this project's trade assignments. */
  disciplineName: string | null;
  partnerName: string | null;
```

In `leafMatches`, extend the haystack:

```ts
    const hit =
      a.name.toLowerCase().includes(needle) ||
      (a.canonicalScope ?? "").toLowerCase().includes(needle) ||
      (a.disciplineName ?? "").toLowerCase().includes(needle) ||
      (a.partnerName ?? "").toLowerCase().includes(needle) ||
      (a.wbsCode ?? "").includes(needle) ||
      String(a.externalId ?? "").includes(needle);
```

- [ ] **Step 3: Add the discipline filter**

Add state beside the existing filters:

```ts
  const [discipline, setDiscipline] = useState("all");
```

`leafMatches` needs the selected discipline, so change its signature and both call sites:

```ts
function leafMatches(a: ActivityRow, q: string, filter: Filter, discipline: string): boolean {
```

and add before the final `return true`:

```ts
  if (discipline !== "all" && a.disciplineName !== discipline) return false;
```

Call sites become `leafMatches(a, q, filter, discipline)` in both `flatView` and the grouped `matchedLeafIds`; add `discipline` to both `useMemo` dependency arrays.

Build the option list:

```ts
  const disciplines = useMemo(
    () => [...new Set(rows.map((r) => r.disciplineName).filter((d): d is string => Boolean(d)))].sort(),
    [rows],
  );
```

Render it after the existing status filter select. One select, not two: with one partner per discipline per project, filtering by discipline already filters by partner.

```tsx
        {disciplines.length > 0 && (
          <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm">
            <option value="all">All trades</option>
            {disciplines.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
```

- [ ] **Step 4: Show it in the expanded detail**

In `renderLeafRow`, inside the `<dl>`, before the `customFields` map:

```tsx
            {a.disciplineName && <div>Discipline: {a.disciplineName}</div>}
            {a.partnerName && <div>Trade partner: {a.partnerName}</div>}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: clean typecheck, successful build, 190+ tests pass.

Then start the app and confirm by hand:

```bash
npm start
```

Open a project, expand an activity with a mapped scope, and confirm Discipline and Trade partner appear; type a partner name into the search box and confirm it filters; pick a discipline from the new select.

- [ ] **Step 6: Commit**

```bash
git add app/projects/[id]/page.tsx components/ActivityTable.tsx
git commit -m "feat(schedule): show, search and filter by trade on the activity table

Who is doing the work was only visible on the Trades page, one discipline at a
time. One select covers both discipline and partner because the project model
is one partner per discipline."
```

---

### Task 6: Write trade columns into the export

**Files:**
- Create: `lib/export/injectTrades.ts`
- Test: `tests/export/injectTrades.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (operates on the parsed document)
- Produces: `injectTrades(doc: Record<string, unknown>, tradeByUid: Map<number, { disciplineName: string; partnerName: string | null }>): Record<string, unknown>`

Background the implementer needs: an MSPDI document has `Project.ExtendedAttributes.ExtendedAttribute[]` declaring custom fields (`FieldID`, `FieldName`, `Alias`), and each `Project.Tasks.Task` may carry `ExtendedAttribute[]` entries of `{ FieldID, Value }`. The importer keys values by the declared `Alias`, so the aliases are the round-trip contract. Task text field ids run `Text1` = 188743731, `Text2` = 188743734, `Text3` = 188743737, in steps of 3.

- [ ] **Step 1: Write the failing test**

Create `tests/export/injectTrades.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { injectTrades } from "@/lib/export/injectTrades";

function docWith(existing?: Record<string, unknown>) {
  return {
    Project: {
      ...(existing ? { ExtendedAttributes: { ExtendedAttribute: existing } } : {}),
      Tasks: { Task: [{ UID: "1", Name: "Hang Drywall" }, { UID: "2", Name: "Pull Wire" }] },
    },
  } as Record<string, unknown>;
}

const trades = new Map([
  [1, { disciplineName: "09A: DRYWALL", partnerName: "Carrco" }],
  [2, { disciplineName: "26A: ELECTRICAL", partnerName: null }],
]);

function defs(doc: Record<string, unknown>) {
  const p = doc.Project as Record<string, unknown>;
  const ea = (p.ExtendedAttributes as Record<string, unknown>)?.ExtendedAttribute;
  return (Array.isArray(ea) ? ea : [ea]) as Record<string, unknown>[];
}
function taskAttrs(doc: Record<string, unknown>, i: number) {
  const project = doc.Project as Record<string, unknown>;
  const tasks = (project.Tasks as Record<string, unknown>).Task as Record<string, unknown>[];
  const ea = tasks[i].ExtendedAttribute;
  return (Array.isArray(ea) ? ea : ea ? [ea] : []) as Record<string, unknown>[];
}

describe("injectTrades", () => {
  it("declares both aliases and writes values onto matching tasks", () => {
    const doc = injectTrades(docWith(), trades);
    const aliases = defs(doc).map((d) => d.Alias);
    expect(aliases).toEqual(expect.arrayContaining(["Discipline", "Trade Partner"]));

    const first = taskAttrs(doc, 0);
    expect(first).toHaveLength(2);
    expect(first.map((a) => a.Value)).toEqual(expect.arrayContaining(["09A: DRYWALL", "Carrco"]));
  });

  it("writes the discipline alone when no partner is assigned", () => {
    const doc = injectTrades(docWith(), trades);
    const second = taskAttrs(doc, 1);
    expect(second.map((a) => a.Value)).toEqual(["26A: ELECTRICAL"]);
  });

  it("skips text slots the file already uses", () => {
    const doc = injectTrades(
      docWith({ FieldID: "188743731", FieldName: "Text1", Alias: "Phoenix ID" }),
      trades,
    );
    // Phoenix ID survives untouched, and ours land in the next free slots.
    const phoenix = defs(doc).find((d) => d.Alias === "Phoenix ID");
    expect(phoenix?.FieldID).toBe("188743731");
    expect(defs(doc).find((d) => d.Alias === "Discipline")?.FieldID).toBe("188743734");
    expect(defs(doc).find((d) => d.Alias === "Trade Partner")?.FieldID).toBe("188743737");
    expect(defs(doc)).toHaveLength(3);
  });

  it("writes nothing when no activity resolves to a trade", () => {
    const doc = injectTrades(docWith(), new Map());
    expect(doc.Project).not.toHaveProperty("ExtendedAttributes");
    expect(taskAttrs(doc, 0)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/export/injectTrades.test.ts`
Expected: FAIL — cannot resolve `@/lib/export/injectTrades`.

- [ ] **Step 3: Implement**

Create `lib/export/injectTrades.ts`:

```ts
export interface TradeForExport {
  disciplineName: string;
  partnerName: string | null;
}

type AnyRec = Record<string, unknown>;

function asArray(v: unknown): AnyRec[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as AnyRec[];
}

// MSPDI task text fields. Text1 is 188743731 and each subsequent slot is +3.
const TEXT1_FIELD_ID = 188743731;
const TEXT_SLOTS = 30;

/** Text field ids the uploaded file already declares — never overwrite a customer's own column. */
function usedFieldIds(project: AnyRec): Set<string> {
  const declared = asArray((project.ExtendedAttributes as AnyRec | undefined)?.ExtendedAttribute);
  return new Set(declared.map((d) => String(d.FieldID)));
}

function freeSlots(project: AnyRec, count: number): string[] {
  const used = usedFieldIds(project);
  const free: string[] = [];
  for (let i = 0; i < TEXT_SLOTS && free.length < count; i += 1) {
    const id = String(TEXT1_FIELD_ID + i * 3);
    if (!used.has(id)) free.push(id);
  }
  return free;
}

/**
 * Writes each activity's discipline and trade partner into the exported file as
 * two custom columns, so the schedule carries who is doing the work into MS
 * Project — and so a later import can read them back and flag what changed.
 *
 * The aliases are the round-trip contract: the importer keys customFields by
 * alias, not by field id, because the id it lands in depends on which slots the
 * customer's own file already occupies.
 */
export function injectTrades(doc: AnyRec, tradeByUid: Map<number, TradeForExport>): AnyRec {
  if (tradeByUid.size === 0) return doc;
  const project = doc.Project as AnyRec | undefined;
  if (!project) return doc;

  const [disciplineId, partnerId] = freeSlots(project, 2);
  if (!disciplineId || !partnerId) return doc;

  const definitions = asArray((project.ExtendedAttributes as AnyRec | undefined)?.ExtendedAttribute);
  definitions.push(
    { FieldID: disciplineId, FieldName: `Text${(Number(disciplineId) - TEXT1_FIELD_ID) / 3 + 1}`, Alias: "Discipline" },
    { FieldID: partnerId, FieldName: `Text${(Number(partnerId) - TEXT1_FIELD_ID) / 3 + 1}`, Alias: "Trade Partner" },
  );
  project.ExtendedAttributes = { ExtendedAttribute: definitions };

  const tasksNode = project.Tasks as AnyRec | undefined;
  for (const task of asArray(tasksNode?.Task)) {
    const trade = tradeByUid.get(Number(task.UID));
    if (!trade) continue;
    const attrs = asArray(task.ExtendedAttribute);
    attrs.push({ FieldID: disciplineId, Value: trade.disciplineName });
    if (trade.partnerName) attrs.push({ FieldID: partnerId, Value: trade.partnerName });
    task.ExtendedAttribute = attrs;
  }
  return doc;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/export/injectTrades.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/export/injectTrades.ts tests/export/injectTrades.test.ts
git commit -m "feat(export): write discipline and trade partner as MS Project columns

Slots are picked from the field ids the uploaded file already declares, so a
customer's own custom column is skipped rather than overwritten. The aliases
are the contract the importer reads back by."
```

---

### Task 7: Call injectTrades from the export and prove the round-trip

**Files:**
- Modify: `lib/export/buildExport.ts`
- Test: `tests/export/buildExport.test.ts`

**Interfaces:**
- Consumes: `injectTrades` from Task 6, `resolveActivityTrades` from Task 4
- Produces: exported XML carrying both aliases

- [ ] **Step 1: Write the failing round-trip test**

Add to `tests/export/buildExport.test.ts`, inside the existing DB-gated describe. It exports and then re-parses with the real importer, which is what proves the contract:

```ts
it("round-trips discipline and partner through the exported file", async () => {
  const scope = `ZZ Trade Scope ${Date.now()}`;
  const project = await prisma.project.create({ data: { name: "Trade Export Test" } });
  await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });

  const imp = await prisma.scheduleImport.findFirstOrThrow({ where: { projectId: project.id }, include: { activities: true } });
  const target = imp.activities.find((a) => a.name === "Electrical Rough-In")!;
  await prisma.scopeDictionaryEntry.upsert({
    where: { normalizedName: "electrical rough-in" },
    create: { normalizedName: "electrical rough-in", canonicalScope: scope },
    update: { canonicalScope: scope },
  });
  await prisma.tradeDictionaryEntry.upsert({
    where: { canonicalScope: scope },
    create: { canonicalScope: scope, osDisciplineId: 26, disciplineName: "26A: ELECTRICAL" },
    update: { osDisciplineId: 26, disciplineName: "26A: ELECTRICAL" },
  });
  await prisma.osTradePartner.create({
    data: { projectId: project.id, osPartnerId: 77, name: "Amber Electrical", disciplines: [{ id: 26, name: "26A: ELECTRICAL", division: "26" }] },
  });
  await prisma.projectTradeAssignment.create({
    data: { projectId: project.id, osDisciplineId: 26, osPartnerId: 77, partnerName: "Amber Electrical" },
  });

  const { id: draftId } = await getOrCreateDraft(project.id, "2026-06-18", 1);
  await saveEntries(draftId, [{ activityExternalUid: target.externalUid, canonicalActivityKey: target.canonicalActivityKey, status: "complete", actualStart: "2026-06-16", actualFinish: "2026-06-17", percentComplete: 100, note: null }]);
  await finalizeUpdate(draftId);

  const { xml: out } = await buildExport(project.id, xml, "minimal.xml");
  const reparsed = parseMspXml(out);
  const reimported = reparsed.activities.find((a) => a.externalUid === target.externalUid)!;
  expect(reimported.customFields["Discipline"]).toBe("26A: ELECTRICAL");
  expect(reimported.customFields["Trade Partner"]).toBe("Amber Electrical");

  await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: "electrical rough-in" } });
  await prisma.tradeDictionaryEntry.deleteMany({ where: { canonicalScope: scope } });
  await prisma.project.delete({ where: { id: project.id } });
}, 30000);
```

Add `import { parseMspXml } from "@/lib/msp/parseMspXml";` to the file if absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/export/buildExport.test.ts -t "round-trips discipline"`
Expected: FAIL — `customFields["Discipline"]` is undefined.

- [ ] **Step 3: Wire it into buildExport**

In `lib/export/buildExport.ts`, add imports:

```ts
import { injectTrades, type TradeForExport } from "@/lib/export/injectTrades";
import { resolveActivityTrades } from "@/lib/trades/activityTrades";
```

After the `nameByUid` block, build the UID-keyed trade map:

```ts
  const trades = await resolveActivityTrades(
    projectId,
    latest.activities.map((a) => ({ id: a.id, name: a.name })),
  );
  const tradeByUid = new Map<number, TradeForExport>();
  for (const a of latest.activities) {
    const trade = trades.get(a.id);
    if (trade) tradeByUid.set(a.externalUid, trade);
  }
```

Call it alongside the other injectors, after `injectNames(doc, nameByUid);`:

```ts
  injectTrades(doc, tradeByUid);
```

- [ ] **Step 4: Run the tests**

Run: `npm run test`
Expected: PASS, including the pre-existing export tests.

- [ ] **Step 5: Verify in MS Project by hand**

This step cannot be automated and must not be skipped. A wrong `FieldID` makes the columns silently fail to appear, which is precisely the failure mode this codebase has been removing.

Export a schedule from the app, open the `.xml` in MS Project, insert the **Text2** and **Text3** columns, and confirm they show the discipline and partner with the aliases "Discipline" and "Trade Partner". If the ids are wrong, correct `TEXT1_FIELD_ID` / the step of 3 in `lib/export/injectTrades.ts` and re-run Task 6's tests.

- [ ] **Step 6: Commit**

```bash
git add lib/export/buildExport.ts tests/export/buildExport.test.ts
git commit -m "feat(export): carry trade assignments into the exported schedule

Verified by exporting and re-parsing with the real importer, so the alias
contract is proven rather than assumed."
```

---

### Task 8: Detect trade drift on a re-imported file

**Files:**
- Create: `lib/trades/tradeDrift.ts`
- Modify: `prisma/schema.prisma` (add `TradeDriftDismissal`, plus the back-relation on `Project`)
- Test: `tests/trades/tradeDrift.test.ts`

**Interfaces:**
- Consumes: `ActivityTrade` from Task 4
- Produces:
  - `type TradeDriftRow = { osDisciplineId: number; disciplineName: string; fileValue: string; toolValue: string | null; activityCount: number }`
  - `findTradeDrift(activities, trades, disciplineIdByName, dismissed): TradeDriftRow[]` — pure
  - `getTradeDrift(projectId): Promise<TradeDriftRow[]>` — loads then delegates

- [ ] **Step 1: Add the dismissal table**

In `prisma/schema.prisma`, add after `TradeScopeDismissal`:

```prisma
// A trade partner named in a re-imported MS Project file that disagrees with
// this project's assignment, which someone chose to keep. Keyed on the file's
// value so a *different* later edit flags again rather than inheriting this
// decision.
model TradeDriftDismissal {
  id             String   @id @default(cuid())
  projectId      String
  project        Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  osDisciplineId Int
  fileValue      String
  dismissedBy    String?
  personId       Int?
  createdAt      DateTime @default(now())

  @@unique([projectId, osDisciplineId, fileValue])
  @@index([projectId])
}
```

Add the back-relation to `model Project`, beside `tradeScopeDismissals`:

```prisma
  tradeDriftDismissals   TradeDriftDismissal[]
```

Run: `npx prisma migrate dev --name add_trade_drift_dismissal`

- [ ] **Step 2: Write the failing test**

Create `tests/trades/tradeDrift.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findTradeDrift } from "@/lib/trades/tradeDrift";
import type { ActivityTrade } from "@/lib/trades/activityTrades";

const disciplineIdByName = new Map([["26A: ELECTRICAL", 26]]);
const trades = new Map<string, ActivityTrade>([
  ["a1", { disciplineName: "26A: ELECTRICAL", partnerName: "Amber Electrical" }],
  ["a2", { disciplineName: "26A: ELECTRICAL", partnerName: "Amber Electrical" }],
]);
const act = (id: string, partner?: string) => ({
  id,
  customFields: partner ? { "Trade Partner": partner } : {},
});

describe("findTradeDrift", () => {
  it("flags a file value that disagrees with the assignment", () => {
    const rows = findTradeDrift([act("a1", "Facility Solutions")], trades, disciplineIdByName, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      osDisciplineId: 26, disciplineName: "26A: ELECTRICAL",
      fileValue: "Facility Solutions", toolValue: "Amber Electrical", activityCount: 1,
    });
  });

  it("does not flag agreement", () => {
    expect(findTradeDrift([act("a1", "Amber Electrical")], trades, disciplineIdByName, new Set())).toEqual([]);
  });

  it("does not flag an activity with no trade column", () => {
    expect(findTradeDrift([act("a1")], trades, disciplineIdByName, new Set())).toEqual([]);
  });

  it("counts activities but keeps distinct file values apart", () => {
    const rows = findTradeDrift(
      [act("a1", "Facility Solutions"), act("a2", "Someone Else")],
      trades, disciplineIdByName, new Set(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.fileValue).sort()).toEqual(["Facility Solutions", "Someone Else"]);
  });

  it("honours a dismissal of that exact value", () => {
    const rows = findTradeDrift(
      [act("a1", "Facility Solutions")], trades, disciplineIdByName, new Set(["26::Facility Solutions"]),
    );
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/trades/tradeDrift.test.ts`
Expected: FAIL — cannot resolve `@/lib/trades/tradeDrift`.

- [ ] **Step 4: Implement**

Create `lib/trades/tradeDrift.ts`:

```ts
import { prisma } from "@/lib/db";
import { resolveActivityTrades, type ActivityTrade } from "@/lib/trades/activityTrades";
import { getProjectDisciplines } from "@/lib/trades/tradesService";
import { isLeafActive } from "@/lib/completeness/completenessService";

export const TRADE_PARTNER_ALIAS = "Trade Partner";

export interface TradeDriftRow {
  osDisciplineId: number;
  disciplineName: string;
  fileValue: string;
  toolValue: string | null;
  activityCount: number;
}

export interface ActivityWithFields {
  id: string;
  customFields: Record<string, string>;
}

export const dismissalKey = (osDisciplineId: number, fileValue: string) => `${osDisciplineId}::${fileValue}`;

/**
 * Where a re-imported file names a different trade partner than this project
 * has assigned.
 *
 * One row per (discipline, distinct file value): if a file names two different
 * partners on two activities of one discipline, that is two decisions, and
 * collapsing them would force one answer onto both and hide the second.
 */
export function findTradeDrift(
  activities: ActivityWithFields[],
  trades: Map<string, ActivityTrade>,
  disciplineIdByName: Map<string, number>,
  dismissed: Set<string>,
): TradeDriftRow[] {
  const byKey = new Map<string, TradeDriftRow>();
  for (const activity of activities) {
    const fileValue = activity.customFields?.[TRADE_PARTNER_ALIAS];
    if (!fileValue) continue;
    const trade = trades.get(activity.id);
    if (!trade) continue;
    if (trade.partnerName === fileValue) continue;

    const osDisciplineId = disciplineIdByName.get(trade.disciplineName);
    if (osDisciplineId === undefined) continue;

    const key = dismissalKey(osDisciplineId, fileValue);
    if (dismissed.has(key)) continue;

    const existing = byKey.get(key);
    if (existing) existing.activityCount += 1;
    else byKey.set(key, {
      osDisciplineId,
      disciplineName: trade.disciplineName,
      fileValue,
      toolValue: trade.partnerName,
      activityCount: 1,
    });
  }
  return [...byKey.values()].sort((a, b) => a.disciplineName.localeCompare(b.disciplineName));
}

export async function getTradeDrift(projectId: string): Promise<TradeDriftRow[]> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  if (!latest) return [];

  const leaves = latest.activities.filter(isLeafActive);
  const [trades, disciplines, dismissals] = await Promise.all([
    resolveActivityTrades(projectId, leaves.map((a) => ({ id: a.id, name: a.name }))),
    getProjectDisciplines(projectId),
    prisma.tradeDriftDismissal.findMany({ where: { projectId } }),
  ]);

  return findTradeDrift(
    leaves.map((a) => ({ id: a.id, customFields: (a.customFields as Record<string, string>) ?? {} })),
    trades,
    new Map(disciplines.map((d) => [d.name, d.id])),
    new Set(dismissals.map((d) => dismissalKey(d.osDisciplineId, d.fileValue))),
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/trades/tradeDrift.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/trades/tradeDrift.ts tests/trades/tradeDrift.test.ts
git commit -m "feat(trades): detect trade partner drift on a re-imported file

Compared against the derived assignment rather than a stored export snapshot —
a snapshot table would separate 'edited in MS Project' from 'reassigned here
since exporting' at the cost of a write on every export, and both cases want
review anyway. Dismissals key on the file's value so a different later edit
flags again."
```

---

### Task 9: Review drift on the Trades page

**Files:**
- Create: `app/api/trades/drift/route.ts`
- Modify: `app/projects/[id]/trades/page.tsx`
- Modify: `components/TradesPanel.tsx`

**Interfaces:**
- Consumes: `getTradeDrift`, `TradeDriftRow` from Task 8; `assignTradePartner` from `@/lib/trades/tradesService`
- Produces: `POST /api/trades/drift` with `{ projectId, osDisciplineId, fileValue, action: "accept" | "keep" }`

- [ ] **Step 1: Add the route**

Create `app/api/trades/drift/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assignTradePartner } from "@/lib/trades/tradesService";
import { denyOutOfScope, scopeFromRequest } from "@/lib/scope";

interface DriftBody {
  projectId?: string;
  osDisciplineId?: number;
  fileValue?: string;
  action?: "accept" | "keep";
}

export async function POST(req: Request) {
  const body = (await req.json()) as DriftBody;
  if (!body.projectId || !Number.isInteger(body.osDisciplineId) || !body.fileValue?.trim() || !body.action) {
    return NextResponse.json(
      { error: { message: "projectId, osDisciplineId, fileValue and action are required." } },
      { status: 422 },
    );
  }

  const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
  const denied = denyOutOfScope(scope, body.projectId);
  if (denied) return denied;

  const osDisciplineId = body.osDisciplineId as number;
  const fileValue = body.fileValue.trim();

  if (body.action === "keep") {
    await prisma.tradeDriftDismissal.upsert({
      where: { projectId_osDisciplineId_fileValue: { projectId: body.projectId, osDisciplineId, fileValue } },
      create: { projectId: body.projectId, osDisciplineId, fileValue, personId: scope?.personId ?? null },
      update: { personId: scope?.personId ?? null },
    });
    return NextResponse.json({ ok: true });
  }

  // Connect owns the roster. A name that matches no partner on this project is
  // reported, never guessed at — inventing an id would misroute a trade.
  const partner = await prisma.osTradePartner.findFirst({
    where: { projectId: body.projectId, name: fileValue, doNotUse: false },
    select: { osPartnerId: true },
  });
  if (!partner) {
    return NextResponse.json(
      { error: { message: `"${fileValue}" is not a trade partner on this project in Skiles Connect.` } },
      { status: 422 },
    );
  }

  await assignTradePartner(body.projectId, osDisciplineId, partner.osPartnerId, scope?.personId);
  await prisma.tradeDriftDismissal.deleteMany({ where: { projectId: body.projectId, osDisciplineId } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Load drift on the page**

In `app/projects/[id]/trades/page.tsx`, add:

```ts
import { getTradeDrift } from "@/lib/trades/tradeDrift";
```

```ts
  const driftRows = await getTradeDrift(project.id);
```

and pass `driftRows={driftRows}` to `<TradesPanel …>`.

- [ ] **Step 3: Add the tab**

In `components/TradesPanel.tsx`, add the import and prop:

```ts
import type { TradeDriftRow } from "@/lib/trades/tradeDrift";
```

Add `driftRows` to the props type (`driftRows: TradeDriftRow[]`) and destructuring. Extend the tab union:

```ts
type Tab = "assignment" | "unmapped" | "dismissed" | "drift";
```

Add to the tab list, after `assignment`:

```ts
          ["drift", `Changed in MS Project (${driftRows.length})`],
```

Add the resolver beside `dismiss`/`restore`:

```ts
  async function resolveDrift(row: TradeDriftRow, action: "accept" | "keep") {
    const key = `${row.osDisciplineId}::${row.fileValue}`;
    setRowBusy(key);
    setError(null);
    const res = await fetch(appPath("/api/trades/drift"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, osDisciplineId: row.osDisciplineId, fileValue: row.fileValue, action }),
    });
    setRowBusy(null);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Could not resolve.");
      return;
    }
    router.refresh();
  }
```

Add the panel after the `assignment` section:

```tsx
      {tab === "drift" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Changed in MS Project</h2>
          <p className="text-xs text-slate-500">
            The re-imported file names a different trade partner than this project has assigned.
          </p>
          {driftRows.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing has changed in the file.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
              {driftRows.map((r) => {
                const key = `${r.osDisciplineId}::${r.fileValue}`;
                const busy = rowBusy === key;
                return (
                  <li key={key} className="px-3 py-3">
                    <div className="font-medium">{r.disciplineName}</div>
                    <div className="mt-1 text-xs text-slate-600">
                      file: <span className="font-medium">{r.fileValue}</span> · here:{" "}
                      <span className="font-medium">{r.toolValue ?? "unassigned"}</span> · {r.activityCount} activit
                      {r.activityCount === 1 ? "y" : "ies"}
                    </div>
                    <div className="mt-2 flex gap-1">
                      <button
                        disabled={busy}
                        onClick={() => resolveDrift(r, "accept")}
                        className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        {busy ? "Working…" : "Accept file"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => resolveDrift(r, "keep")}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                      >
                        {busy ? "Working…" : "Keep this one"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run build && npm run test`
Expected: clean typecheck, successful build, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/trades/drift/route.ts app/projects/[id]/trades/page.tsx components/TradesPanel.tsx
git commit -m "feat(trades): review trade changes made in MS Project

A fourth tab listing where the re-imported file disagrees with this project's
assignments. Accepting a partner Connect does not have on the project is
refused with its name rather than guessed at."
```

---

## Verification checklist

Before calling this done:

- [ ] `npm run build` compiles
- [ ] `npm run test` — all tests pass, including the new ones
- [ ] `npx tsc --noEmit` clean
- [ ] Batch accept on a real coarse scope produces **one** new synthetic import, not N
- [ ] A dismissed instance survives a batch accept
- [ ] Exported XML opened in MS Project shows the Discipline and Trade Partner columns (Task 7, Step 5 — manual, cannot be skipped)
- [ ] Editing a partner in MS Project, re-importing, and finding it on the Changed in MS Project tab
- [ ] Accepting that change updates the Trade Assignment tab
