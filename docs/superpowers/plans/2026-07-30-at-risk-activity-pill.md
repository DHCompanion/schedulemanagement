# AT RISK Activity Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an `AT RISK` pill on a schedule activity when procurement has flagged that activity's trade partner.

**Architecture:** `/launch` fetches `procurement_project_summary` from the OS tool gateway and caches it per project × partner, exactly as `cacheTradePartners` already does for the OS roster. The project page reads that cache, resolves each activity to an `osPartnerId` through the existing scope → discipline → assignment chain, and passes a boolean to `ActivityTable`, which renders a pill. No gateway token is kept after launch.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Prisma + PostgreSQL (Neon), Vitest + Testing Library + happy-dom, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-30-at-risk-activity-pill-design.md`

## Global Constraints

- TypeScript strict — fix types, never use `any` to silence errors.
- No `console.log` in server-side code.
- Join partners on `osPartnerId` only. Never on `partnerName` — it is a display snapshot that will not survive a partner rename.
- A procurement fetch failure must never block launch. Swallow it and keep the previous cache.
- The pill is **amber** (`bg-amber-100` / `text-amber-800`), never red. Red already means critical path on the same row.
- Leaf activity rows only. No roll-up onto WBS section headers.
- The pill is suppressed when `percentComplete === 100`.
- Store every partner row returned, not only flagged ones — the "checked, nothing flagged" page state depends on rows existing.
- Run `npm run build` and `npm run test` before review.

## Known blocker (does not stop this work)

Procurement's production service returns `500 {"error":"PROCUREMENT_MANAGER_CONTEXT_SECRET is not set"}` — the variable is misspelled `..._CONTECT_SECRET` in both repos' env. Every task below is buildable and unit-testable against fixtures; only end-to-end verification is blocked. Until it is fixed, a real launch caches zero rows, which renders as "unknown" rather than "nothing at risk".

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/os-gateway.ts` | modify | Add `getProcurementSummary` beside `getTradePartners` |
| `prisma/schema.prisma` | modify | `OsProcurementRisk` model + `Project` back-relation |
| `prisma/migrations/<ts>_add_os_procurement_risk_cache/` | create | Generated migration |
| `app/launch/route.ts` | modify | `cacheProcurementRisk` next to `cacheTradePartners` |
| `lib/trades/activityTrades.ts` | modify | `osPartnerId` on `ActivityTrade`; `isActivityAtRisk` predicate |
| `app/projects/[id]/page.tsx` | modify | Load cache, set `atRisk` per row, render freshness line |
| `components/ActivityTable.tsx` | modify | `atRisk` on `ActivityRow`; render the pill |
| `tests/trades/osGateway.test.ts` | modify | Cover the new gateway call |
| `tests/trades/activityTrades.test.ts` | modify | Update 4 broken assertions; cover the predicate |
| `tests/launch.test.ts` | modify | Cache-on-success and survive-failure |
| `tests/components/ActivityTable.test.tsx` | create | Pill renders / does not render |

---

### Task 1: Gateway client for the procurement packet

**Files:**
- Modify: `lib/os-gateway.ts` (append after `getTradePartners`, ends line 52)
- Test: `tests/trades/osGateway.test.ts`

**Interfaces:**
- Consumes: the module-private `call(path, token, init)` helper already in `lib/os-gateway.ts:19`.
- Produces: `getProcurementSummary(token: string, limit?: number): Promise<OsProcurementSummary>`, plus exported types `OsProcurementRiskItem` and `OsProcurementSummary`. Tasks 3 and 5 depend on these exact names.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("os-gateway", ...)` block in `tests/trades/osGateway.test.ts`. Add `getProcurementSummary` to the import on line 2.

```ts
  it("posts a context request for the procurement packet", async () => {
    const fetchMock = stub(true, {
      packetType: "procurement_project_summary",
      projectId: 9, items: [], summary: {}, warnings: [],
    });
    await getProcurementSummary("tok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/tool-gateway/context-requests");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("names the target and packet type, and sends no project or person", async () => {
    const fetchMock = stub(true, { items: [] });
    await getProcurementSummary("tok");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // The OS derives project and person from the token; sending them is a contract violation.
    expect(body).toEqual({
      target: "procurement-manager",
      packetType: "procurement_project_summary",
      limit: 25,
    });
  });

  it("returns an empty packet as a normal answer", async () => {
    stub(true, { packetType: "procurement_project_summary", projectId: 9, items: [], summary: {}, warnings: ["No procurement project is linked to this Connect project yet."] });
    const packet = await getProcurementSummary("tok");
    expect(packet.items).toEqual([]);
    expect(packet.warnings).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/trades/osGateway.test.ts`
Expected: FAIL — `getProcurementSummary` is not exported from `@/lib/os-gateway`.

- [ ] **Step 3: Implement**

Append to `lib/os-gateway.ts`:

```ts
// One row per trade partner, mirroring the grain of the packet this tool serves
// in the other direction. The OS caps a packet at 25 items; a project runs 10-15
// trade partners, so the whole project fits inside the cap.
export type OsProcurementRiskItem = {
  osPartnerId: number;
  partnerName: string;
  itemCount: number;
  earliestRequiredOnSite: string | null;
  leastAdvancedState: string;
  openVarianceCount: number;
  atRiskCount: number;
};

export type OsProcurementSummary = {
  packetType: string;
  projectId: number;
  items: OsProcurementRiskItem[];
  summary: Record<string, unknown>;
  warnings: string[];
};

// OS-mediated read of the procurement tool's project summary. Neither tool calls
// the other: the OS authorizes the request, calls procurement server-to-server,
// and hands back the payload. An empty `items` with a warning is a normal answer.
export async function getProcurementSummary(token: string, limit = 25): Promise<OsProcurementSummary> {
  return (await call("/context-requests", token, {
    method: "POST",
    body: JSON.stringify({
      target: "procurement-manager",
      packetType: "procurement_project_summary",
      limit,
    }),
  })) as OsProcurementSummary;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/trades/osGateway.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/os-gateway.ts tests/trades/osGateway.test.ts
git commit -m "feat(os): read the procurement project summary through the gateway"
```

---

### Task 2: Cache table

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_os_procurement_risk_cache/migration.sql` (generated)

**Interfaces:**
- Produces: the `OsProcurementRisk` Prisma model. Tasks 3 and 5 read and write it via `prisma.osProcurementRisk`.

This task has no test of its own — a schema with no reader proves nothing. Tasks 3 and 5 exercise it.

- [ ] **Step 1: Add the model**

Append to `prisma/schema.prisma`, following the `OsTradePartner` model it mirrors:

```prisma
// Cached procurement status per trade partner, refreshed at launch from the OS
// `procurement_project_summary` packet. Cached rather than fetched live because
// the gateway token lives 15 minutes and is discarded after launch: an absent
// pill must never be mistaken for "not at risk".
// Every returned partner is stored, not only flagged ones — the presence of any
// row is what lets the page distinguish "checked, nothing flagged" from "unknown".
model OsProcurementRisk {
  id                     String    @id @default(cuid())
  projectId              String
  project                Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  osPartnerId            Int
  partnerName            String
  itemCount              Int
  atRiskCount            Int
  openVarianceCount      Int
  earliestRequiredOnSite DateTime?
  leastAdvancedState     String
  fetchedAt              DateTime  @default(now())

  @@unique([projectId, osPartnerId])
}
```

- [ ] **Step 2: Add the back-relation**

In the `Project` model, after the `osTradePartners` line (`prisma/schema.prisma:38`):

```prisma
  osProcurementRisks     OsProcurementRisk[]
```

- [ ] **Step 3: Generate the migration**

Run: `npm run prisma:migrate -- --name add_os_procurement_risk_cache`
Expected: a new folder under `prisma/migrations/`, and the client regenerated.

- [ ] **Step 4: Verify the client has the model**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit schema and migration together**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): cache procurement risk per trade partner

Cached at launch rather than fetched per render: the gateway token lives 15
minutes, and a pill that silently vanishes reads as 'not at risk'."
```

---

### Task 3: Populate the cache at launch

**Files:**
- Modify: `app/launch/route.ts` (call site at line 54; new function after `cacheTradePartners`, which ends line 95)
- Test: `tests/launch.test.ts`

**Interfaces:**
- Consumes: `getProcurementSummary` (Task 1), `prisma.osProcurementRisk` (Task 2).
- Produces: rows in `OsProcurementRisk` for the launched project. Task 5 reads them.

- [ ] **Step 1: Write the failing tests**

Add to `tests/launch.test.ts`. Add `getProcurementSummary`'s route to a URL-aware fetch stub — the existing `stubGatewayContext` returns one canned body for every call, which cannot express "this one endpoint fails".

```ts
function stubLaunchGateway(osProjectId: number, opts: { procurement: "ok" | "fail" }) {
  const fetchMock = vi.fn(async (url: string) => {
    const target = String(url);
    if (target.includes("/context-requests")) {
      if (opts.procurement === "fail") throw new Error("procurement unreachable");
      return {
        ok: true,
        json: async () => ({
          packetType: "procurement_project_summary",
          projectId: osProjectId,
          items: [
            {
              osPartnerId: 77, partnerName: "Amber Electrical Contractors, Inc.",
              itemCount: 12, earliestRequiredOnSite: "2026-08-04T00:00:00.000Z",
              leastAdvancedState: "submitted", openVarianceCount: 1, atRiskCount: 2,
            },
            {
              osPartnerId: 91, partnerName: "Carrco Painting Contractors, Inc.",
              itemCount: 4, earliestRequiredOnSite: null,
              leastAdvancedState: "delivered", openVarianceCount: 0, atRiskCount: 0,
            },
          ],
          summary: {}, warnings: [],
        }),
      };
    }
    if (target.includes("/trade-partners")) {
      return { ok: true, json: async () => ({ projectId: osProjectId, tradePartners: [] }) };
    }
    return {
      ok: true,
      json: async () => ({
        project: { id: osProjectId, name: "BSW Regional ED", client: "BSW" },
        person: { id: 4, displayName: "A. Woodyard" },
        access: { accessRole: "Superintendent" },
      }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("procurement risk cache", () => {
  it("caches every partner returned, flagged or not", async () => {
    stubLaunchGateway(4101, { procurement: "ok" });
    await GET(launchRequest("?token=t"));

    const project = await prisma.project.findUnique({ where: { osProjectId: 4101 } });
    const rows = await prisma.osProcurementRisk.findMany({
      where: { projectId: project!.id },
      orderBy: { osPartnerId: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].osPartnerId).toBe(77);
    expect(rows[0].atRiskCount).toBe(2);
    expect(rows[0].earliestRequiredOnSite?.toISOString()).toBe("2026-08-04T00:00:00.000Z");
    // Unflagged partners are stored too: their presence is what proves the
    // project was checked at all.
    expect(rows[1].atRiskCount).toBe(0);
    expect(rows[1].earliestRequiredOnSite).toBeNull();
  });

  it("completes the launch when procurement is unreachable", async () => {
    stubLaunchGateway(4102, { procurement: "fail" });
    const res = await GET(launchRequest("?token=t"));

    expect(res.status).toBe(303);
    expect(res.cookies.get(SCOPE_COOKIE)?.value).toBeTruthy();
    const project = await prisma.project.findUnique({ where: { osProjectId: 4102 } });
    expect(project).not.toBeNull();
    expect(await prisma.osProcurementRisk.count({ where: { projectId: project!.id } })).toBe(0);
  });

  it("clears a stale cache when the packet comes back empty", async () => {
    stubLaunchGateway(4103, { procurement: "ok" });
    await GET(launchRequest("?token=t"));
    const project = await prisma.project.findUnique({ where: { osProjectId: 4103 } });
    expect(await prisma.osProcurementRisk.count({ where: { projectId: project!.id } })).toBe(2);

    vi.unstubAllGlobals();
    const emptyMock = vi.fn(async (url: string) => {
      const target = String(url);
      if (target.includes("/context-requests")) {
        return { ok: true, json: async () => ({ packetType: "procurement_project_summary", projectId: 4103, items: [], summary: {}, warnings: ["No procurement project is linked to this Connect project yet."] }) };
      }
      if (target.includes("/trade-partners")) return { ok: true, json: async () => ({ projectId: 4103, tradePartners: [] }) };
      return { ok: true, json: async () => ({ project: { id: 4103, name: "BSW Regional ED" }, person: { id: 4 }, access: { accessRole: "Superintendent" } }) };
    });
    vi.stubGlobal("fetch", emptyMock);

    await GET(launchRequest("?token=t"));
    expect(await prisma.osProcurementRisk.count({ where: { projectId: project!.id } })).toBe(0);
  });
});
```

Assertions are scoped by `projectId` throughout — never global row counts (see commit `ecc976b`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/launch.test.ts`
Expected: FAIL — `prisma.osProcurementRisk` rows are never written; count is 0 in the first test.

- [ ] **Step 3: Implement**

In `app/launch/route.ts`, extend the import on line 5:

```ts
import { getProcurementSummary, getProjectContext, getTradePartners } from "@/lib/os-gateway";
```

Add the call after `await cacheTradePartners(token, project.id);` (line 54):

```ts
  await cacheProcurementRisk(token, project.id);
```

Add the function after `cacheTradePartners` ends (line 95):

```ts
// Launch is the only moment a valid gateway token is in hand, so procurement
// status is fetched here and cached. Failure must not block entry: no cached
// rows renders as "unknown" on the project page, which is the honest answer, and
// the next launch retries.
async function cacheProcurementRisk(token: string, projectId: string): Promise<void> {
  try {
    const packet = await getProcurementSummary(token);
    await prisma.$transaction([
      prisma.osProcurementRisk.deleteMany({ where: { projectId } }),
      prisma.osProcurementRisk.createMany({
        data: packet.items.map((item) => ({
          projectId,
          osPartnerId: item.osPartnerId,
          partnerName: item.partnerName,
          itemCount: item.itemCount,
          atRiskCount: item.atRiskCount,
          openVarianceCount: item.openVarianceCount,
          earliestRequiredOnSite: item.earliestRequiredOnSite ? new Date(item.earliestRequiredOnSite) : null,
          leastAdvancedState: item.leastAdvancedState,
        })),
      }),
    ]);
  } catch {
    // Keep whatever was cached previously.
  }
}
```

An empty `items` array deletes the stale rows and inserts none — which is why the
third test passes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/launch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/launch/route.ts tests/launch.test.ts
git commit -m "feat(launch): cache procurement risk alongside the trade roster"
```

---

### Task 4: Carry `osPartnerId` through the trade chain

**Files:**
- Modify: `lib/trades/activityTrades.ts` (type at line 10, mapping at lines 38-41)
- Test: `tests/trades/activityTrades.test.ts`

**Interfaces:**
- Consumes: `ProjectAssignment` from `lib/trades/tradesService.ts`, which already carries `osPartnerId`.
- Produces: `ActivityTrade` gains `osPartnerId: number | null`; new export `isActivityAtRisk(osPartnerId, percentComplete, flagged)`. Task 5 uses both.

**This task breaks four existing assertions.** `activityTrades.test.ts` uses `toEqual` on the whole `ActivityTrade` object at lines 17, 34 and elsewhere. They must be updated in the same commit, not discovered later.

- [ ] **Step 1: Update the existing assertions and add new failing tests**

In `tests/trades/activityTrades.test.ts`, add `osPartnerId` to every `toEqual` on an `ActivityTrade`:

```ts
    expect(out.get("a1")).toEqual({
      disciplineName: "09A: DRYWALL/ACOUSTICAL",
      partnerName: "Carrco Painting Contractors, Inc.",
      osPartnerId: 4,
    });
```

and, in the "returns the discipline with a null partner" test:

```ts
    expect(out.get("a1")).toEqual({
      disciplineName: "09A: DRYWALL/ACOUSTICAL",
      partnerName: null,
      osPartnerId: null,
    });
```

Then append a new describe block. Update the import on line 2 to include `isActivityAtRisk`.

```ts
describe("isActivityAtRisk", () => {
  const flagged = new Set([77]);

  it("flags an activity whose partner procurement marked at risk", () => {
    expect(isActivityAtRisk(77, 40, flagged)).toBe(true);
  });

  it("does not flag a partner procurement left alone", () => {
    expect(isActivityAtRisk(91, 40, flagged)).toBe(false);
  });

  it("does not flag an activity with no assigned partner", () => {
    expect(isActivityAtRisk(null, 40, flagged)).toBe(false);
  });

  it("suppresses the pill once the work is complete", () => {
    // Finished work cannot be threatened by late material.
    expect(isActivityAtRisk(77, 100, flagged)).toBe(false);
  });

  it("flags an activity with unknown progress", () => {
    expect(isActivityAtRisk(77, null, flagged)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/trades/activityTrades.test.ts`
Expected: FAIL — `isActivityAtRisk` is not exported, and the `toEqual` assertions fail on the missing `osPartnerId`.

- [ ] **Step 3: Implement**

In `lib/trades/activityTrades.ts`, change the type on line 10:

```ts
export type ActivityTrade = {
  disciplineName: string;
  partnerName: string | null;
  /** The OS trade partner id — the join key to any OS-sourced partner data. */
  osPartnerId: number | null;
};
```

Change the mapping inside `resolveActivityTradesWith` (lines 38-41):

```ts
    const assignment = assignments.get(discipline.id);
    out.set(activity.id, {
      disciplineName: discipline.name,
      partnerName: assignment?.name ?? null,
      osPartnerId: assignment?.osPartnerId ?? null,
    });
```

Append to the same file:

```ts
/**
 * Whether an activity wears the AT RISK pill: its partner is one procurement
 * flagged, and the work is not already done. Completed work cannot be threatened
 * by late material.
 */
export function isActivityAtRisk(
  osPartnerId: number | null,
  percentComplete: number | null,
  flagged: Set<number>,
): boolean {
  if (osPartnerId === null) return false;
  if (percentComplete === 100) return false;
  return flagged.has(osPartnerId);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/trades/activityTrades.test.ts`
Expected: PASS.

- [ ] **Step 5: Check no other caller broke**

Run: `npx tsc --noEmit`
Expected: no errors. `ActivityTrade` gained a field rather than changing one, so existing readers of `disciplineName` and `partnerName` are unaffected.

- [ ] **Step 6: Commit**

```bash
git add lib/trades/activityTrades.ts tests/trades/activityTrades.test.ts
git commit -m "feat(trades): carry osPartnerId through the activity trade chain

The join key to any OS-sourced partner data. Never partnerName — that is a
display snapshot and will not survive a rename."
```

---

### Task 5: Wire the project page

**Files:**
- Modify: `app/projects/[id]/page.tsx` (imports line 14, row build lines 47-68, render after line 121)
- Modify: `components/ActivityTable.tsx` (`ActivityRow` interface, lines 6-25)

**Interfaces:**
- Consumes: `prisma.osProcurementRisk` (Task 2), `isActivityAtRisk` (Task 4).
- Produces: `ActivityRow.atRisk: boolean`. Task 6 renders it.

- [ ] **Step 1: Add the field to `ActivityRow`**

In `components/ActivityTable.tsx`, inside the `ActivityRow` interface after `partnerName` (line 21):

```ts
  /** Procurement flagged this activity's trade partner. Resolved server-side. */
  atRisk: boolean;
```

- [ ] **Step 2: Load the cache in the page**

In `app/projects/[id]/page.tsx`, extend the import on line 14:

```ts
import { isActivityAtRisk, resolveActivityTrades } from "@/lib/trades/activityTrades";
```

After the `trades` resolution (line 50), add:

```ts
  // One query serves both the pill and the freshness line. Rows exist for every
  // partner procurement returned, flagged or not, so their presence is what
  // distinguishes "checked, nothing flagged" from "never checked".
  const procurementRisk = await prisma.osProcurementRisk.findMany({
    where: { projectId: project.id },
    select: { osPartnerId: true, atRiskCount: true, fetchedAt: true },
  });
  const flaggedPartners = new Set(
    procurementRisk.filter((r) => r.atRiskCount > 0).map((r) => r.osPartnerId),
  );
  const riskFetchedAt = procurementRisk[0]?.fetchedAt ?? null;
```

- [ ] **Step 3: Set `atRisk` on each row**

The existing `percentComplete` expression is reused so the pill and the `✓ Completed` pill can never disagree. Replace the row mapping (lines 51-68) with:

```ts
  const rows: ActivityRow[] = (latest?.activities ?? []).map((a) => {
    const percentComplete =
      currentProgress.get(a.canonicalActivityKey)?.percentComplete ?? a.percentComplete;
    return {
      id: a.id,
      externalId: a.externalId,
      wbsCode: a.wbsCode,
      name: a.name,
      canonicalScope: scopeDict.get(normalizeName(a.name)) ?? null,
      disciplineName: trades.get(a.id)?.disciplineName ?? null,
      partnerName: trades.get(a.id)?.partnerName ?? null,
      atRisk: isActivityAtRisk(trades.get(a.id)?.osPartnerId ?? null, percentComplete, flaggedPartners),
      type: a.type,
      isCritical: a.isCritical,
      outlineLevel: a.outlineLevel,
      plannedStart: a.plannedStart ? a.plannedStart.toISOString() : null,
      plannedFinish: a.plannedFinish ? a.plannedFinish.toISOString() : null,
      percentComplete,
      totalSlackDays: toDays(a.totalSlackMinutes, mpd),
      durationDays: a.durationDays,
      customFields: (a.customFields as Record<string, string>) ?? {},
    };
  });
```

- [ ] **Step 4: Render the freshness line**

In the fragment that renders when `latest` exists, immediately before `<ActivityTable rows={rows} />` (line 122):

```tsx
          {riskFetchedAt && (
            <p className="mb-2 text-xs text-slate-500">
              Procurement risk as of {riskFetchedAt.toISOString().slice(0, 16).replace("T", " ")}
            </p>
          )}
```

Absent rows means an absent line — the page never claims "nothing is at risk" on the strength of an answer it does not have.

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/projects/[id]/page.tsx components/ActivityTable.tsx
git commit -m "feat(schedule): resolve procurement risk per activity on the project page

The freshness line renders only when cached rows exist, so no pills plus no
line reads as 'unknown' rather than 'nothing at risk'."
```

---

### Task 6: The pill

**Files:**
- Modify: `components/ActivityTable.tsx` (`renderLeafRow`, after the `✓ Completed` pill at lines 155-157)
- Create: `tests/components/ActivityTable.test.tsx`

**Interfaces:**
- Consumes: `ActivityRow.atRisk` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `tests/components/ActivityTable.test.tsx`. The `// @vitest-environment happy-dom` pragma on line 1 is required — without it the render throws.

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ActivityTable, type ActivityRow } from "@/components/ActivityTable";

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: "a1",
  externalId: 101,
  wbsCode: "1.2.3",
  name: "Electrical Rough-In L2",
  canonicalScope: null,
  disciplineName: "26A: ELECTRICAL",
  partnerName: "Amber Electrical Contractors, Inc.",
  atRisk: false,
  type: "task",
  isCritical: false,
  outlineLevel: 2,
  plannedStart: "2026-08-11T00:00:00.000Z",
  plannedFinish: "2026-09-04T00:00:00.000Z",
  percentComplete: 40,
  totalSlackDays: 3.5,
  durationDays: 18,
  customFields: {},
  ...over,
});

afterEach(() => cleanup());

describe("ActivityTable AT RISK pill", () => {
  it("marks an activity whose partner procurement flagged", () => {
    render(<ActivityTable rows={[row({ atRisk: true })]} />);
    expect(screen.getByText("AT RISK")).toBeTruthy();
  });

  it("leaves an unflagged activity unmarked", () => {
    render(<ActivityTable rows={[row()]} />);
    expect(screen.queryByText("AT RISK")).toBeNull();
  });

  it("does not roll the pill up onto a WBS section header", () => {
    render(
      <ActivityTable
        rows={[
          row({ id: "s1", wbsCode: "1", name: "Level 2", type: "summary", outlineLevel: 1, atRisk: true }),
          row({ id: "a1", wbsCode: "1.1", atRisk: true }),
        ]}
      />,
    );
    // One pill, on the leaf — a header pill cannot say which child is affected.
    expect(screen.getAllByText("AT RISK")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/ActivityTable.test.tsx`
Expected: FAIL — `Unable to find an element with the text: AT RISK`.

- [ ] **Step 3: Implement**

In `components/ActivityTable.tsx`, in `renderLeafRow`, directly after the `✓ Completed` pill block (ends line 157):

```tsx
            {a.atRisk && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                AT RISK
              </span>
            )}
```

Amber, not red: red already marks the critical path on this same line, and two
reds meaning two different things is how a schedule gets misread.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/ActivityTable.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full suite and build**

Run: `npm run test && npm run build`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add components/ActivityTable.tsx tests/components/ActivityTable.test.tsx
git commit -m "feat(schedule): AT RISK pill on activities with flagged procurement"
```

---

## After the plan

Stop for review before pushing, per `CLAUDE.md`.

End-to-end verification is blocked until procurement sets the correctly-spelled
`PROCUREMENT_MANAGER_CONTEXT_SECRET`. Once they do, re-run the probe:

```bash
node -e 'const c=require("crypto");const now=Date.now();const b=JSON.stringify({packetType:"procurement_project_summary",requestingTool:"schedule-manager",projectId:9,personId:4,accessRole:"Project Manager",limit:25,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()});const s=c.createHmac("sha256",process.env.PROCUREMENT_MANAGER_CONTEXT_SECRET).update(b).digest("base64url");fetch("https://sgconnect.dev/procurement-manager/api/os-context",{method:"POST",headers:{"content-type":"application/json","x-os-callback-signature":s},body:b}).then(async r=>console.log(r.status, await r.text()))'
```

Expect `200` and a populated `items` array. Then launch the schedule tool from
Connect into project 9 and confirm the freshness line appears and pills land on
activities belonging to flagged partners.
