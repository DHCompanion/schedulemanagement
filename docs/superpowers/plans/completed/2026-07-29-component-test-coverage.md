# Component Test Coverage and Audit Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the 13 untested client components under test, then use that net to land the over-engineering cleanup safely, then close the remaining route-level gaps.

**Architecture:** Characterisation tests first — they lock in current behaviour so the refactor that follows is provably behaviour-preserving rather than merely compiling. React Testing Library with a happy-dom environment opted into per file; the global test environment stays `node` because most of this suite is database-backed. The refactor phase succeeds only if the characterisation tests pass **unchanged**.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript strict, Vitest 4, Prisma 5 + PostgreSQL, Tailwind.

## Global Constraints

- TypeScript strict. Never use `any` to silence an error.
- No `console.log` in server-side code.
- No dead code — remove anything a refactor orphans.
- Preserve existing UI and behaviour. Phases A, B and D add tests only; only Phase C and E change source.
- Database-backed tests use `describe.runIf(hasDb)` with `const hasDb = !!process.env.DATABASE_URL` and a `30000` ms timeout.
- Component tests must NOT use `describe.runIf(hasDb)` — they touch no database.
- Every component test file starts with the docblock `// @vitest-environment happy-dom` on line 1. Vitest 4 removed `environmentMatchGlobs`; per-file docblocks are the supported mechanism.
- Import alias is `@/` for the repo root.
- Do NOT add `@testing-library/jest-dom` or `@testing-library/user-event`. `element.disabled` and `fireEvent` cover the assertions needed.
- The database holds real user data. Never reset or seed it.
- Run `npm run build` and `npm run test` before considering any task done.
- Work directly on `master`. Do not branch.

---

## File Structure

**Phase A — harness**
- Modify `package.json` — add `@testing-library/react`, `happy-dom` (dev)
- Modify `vitest.config.ts` — widen `include` to `tests/**/*.test.{ts,tsx}`
- Create `tests/helpers/renderClient.tsx` — fetch stub, confirm stub
- Create `tests/components/WizardBanner.test.tsx` — proves the harness

**Phase B — characterisation (tests only, no source changes)**
- Create `tests/components/SplitRulesPanel.test.tsx`
- Create `tests/components/DictionaryPanel.test.tsx`
- Create `tests/components/CoarsePanel.test.tsx`
- Create `tests/components/NormalizePanel.test.tsx`
- Create `tests/components/CompletenessIssuesTable.test.tsx`
- Create `tests/components/TradesPanel.test.tsx`
- Create `tests/components/LookaheadUpdateForm.test.tsx`

**Phase C — the refactor, guarded by Phase B**
- Modify `lib/http.ts` — add `sendJson`
- Create `tests/http.test.ts`
- Modify 7 components — 11 call sites
- Create `components/BusyButton.tsx`
- Modify `TradesPanel.tsx`, `CompletenessIssuesTable.tsx` — 6 button sites

**Phase D — route and lib gaps**
- Create `tests/api/login.test.ts`, `tests/api/health.test.ts`
- Create `tests/os-context/route.test.ts`
- Create `tests/api/updates.test.ts`, `tests/api/projects.test.ts`, `tests/api/importsPreview.test.ts`
- Create `tests/trades/osGateway.test.ts`

**Phase E — remaining audit findings**
- Modify `lib/os-context/scheduleContextPacket.ts`, `lib/msp/types.ts`, `lib/health/dateChecks.ts`, `lib/completeness/completenessService.ts`, `lib/trades/tradeDrift.ts`, `lib/http.ts`

---

### Task 1: Test harness for client components

**Files:**
- Modify: `package.json`, `vitest.config.ts`
- Create: `tests/helpers/renderClient.tsx`, `tests/components/WizardBanner.test.tsx`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `stubFetch(...responses: { ok: boolean; body?: unknown }[]): { calls: StubbedCall[] }`
  - `stubConfirm(answer: boolean): ReturnType<typeof vi.fn>` — returns the mock so a test can read what was asked
  - `interface StubbedCall { url: string; method: string; body: unknown }`

The router mock is deliberately NOT in the helper. `vi.mock` is hoisted to the
top of the file it appears in, so wrapping it in an exported function does not
work — each component test file declares it at top level using `vi.hoisted`, as
shown in Step 4.

- [ ] **Step 1: Install the two dev dependencies**

```bash
npm install -D @testing-library/react@^16.3.2 happy-dom@^20.11.1
```

`@testing-library/dom` arrives as a peer of the first. Do not add anything else.

- [ ] **Step 2: Widen the test include glob**

In `vitest.config.ts`, change:

```ts
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
```

to:

```ts
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"] },
```

Leave `environment: "node"` alone — component test files opt into happy-dom individually.

- [ ] **Step 3: Write the harness**

Create `tests/helpers/renderClient.tsx`:

```tsx
import { vi } from "vitest";

export interface StubbedCall {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Replaces global fetch with a queue of canned responses, recording what was
 * requested. Responses are consumed in order; the last one repeats once the
 * queue is exhausted, so a component that fires N identical requests needs only
 * one entry.
 */
export function stubFetch(...responses: { ok: boolean; body?: unknown }[]): { calls: StubbedCall[] } {
  const calls: StubbedCall[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return { ok: r.ok, json: async () => r.body ?? {} };
    }),
  );
  return { calls };
}

/** Components that gate a destructive action on window.confirm. */
export function stubConfirm(answer: boolean): ReturnType<typeof vi.fn> {
  const mock = vi.fn(() => answer);
  vi.stubGlobal("confirm", mock);
  return mock;
}
```

Every component test file that needs `router.refresh()` opens with this exact
preamble. `vi.hoisted` is what makes the spy visible to the hoisted `vi.mock`
factory:

```tsx
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
```

- [ ] **Step 4: Prove the harness on a component with no behaviour**

Create `tests/components/WizardBanner.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { WizardBanner } from "@/components/WizardBanner";

afterEach(cleanup);

describe("WizardBanner", () => {
  it("labels the step and orders the wizard granularity before naming", () => {
    render(<WizardBanner projectId="p1" step={1} why="because" />);
    expect(screen.getByText(/step 2 of 3/i).textContent).toContain("Task Granularity");
    expect(screen.getByText("because")).toBeTruthy();
  });

  it("offers Finish setup on the last step and no Next", () => {
    render(<WizardBanner projectId="p1" step={2} why="last" />);
    expect(screen.getByText("Finish setup")).toBeTruthy();
    expect(screen.queryByText("Next")).toBeNull();
  });

  it("offers no Back on the first step", () => {
    render(<WizardBanner projectId="p1" step={0} why="first" />);
    expect(screen.queryByText("Back")).toBeNull();
  });
});
```

- [ ] **Step 5: Run it**

Run: `npx vitest run tests/components/WizardBanner.test.tsx`
Expected: PASS, 3 tests. If happy-dom and React 19 disagree, swap `happy-dom` for `jsdom` — install `jsdom` and change the docblock to `// @vitest-environment jsdom`. Nothing else changes.

- [ ] **Step 6: Confirm the existing suite is untouched**

Run: `npm run test`
Expected: all previously passing tests still pass, plus the 3 new ones.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/helpers/renderClient.tsx tests/components/WizardBanner.test.tsx
git commit -m "test: harness for client components

Thirteen client components had no test at all, so a refactor of their fetch
calls could only be checked by compiling and eyeballing a rendered page. React
Testing Library on happy-dom, opted into per file so the database-backed suite
keeps its node environment."
```

---

### Task 2: Characterise the single-button panels

`SplitRulesPanel` and `DictionaryPanel` are the simplest shape: one row-level action, admin-gated, reporting an error into local state.

**Files:**
- Create: `tests/components/SplitRulesPanel.test.tsx`, `tests/components/DictionaryPanel.test.tsx`

**Interfaces:**
- Consumes: `stubFetch` from `tests/helpers/renderClient`, plus the `vi.hoisted` router preamble from Task 1
- Produces: nothing later tasks import

- [ ] **Step 1: Write both test files**

Create `tests/components/SplitRulesPanel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch } from "../helpers/renderClient";
import { SplitRulesPanel } from "@/components/SplitRulesPanel";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const rules = [{ coarseScope: "MEP Rough", finerScopes: ["Electrical Rough", "Plumbing Rough"] }];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("SplitRulesPanel", () => {
  it("shows finer scopes as plain text for a non-admin, with no buttons", () => {
    render(<SplitRulesPanel rules={rules} isAdmin={false} />);
    expect(screen.getByText("Electrical Rough")).toBeTruthy();
    expect(screen.queryByText("Electrical Rough ×")).toBeNull();
  });

  it("removes a rule with the coarse and finer scope in the body", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<SplitRulesPanel rules={rules} isAdmin />);
    fireEvent.click(screen.getByText("Electrical Rough ×"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/completeness/split-rules",
      method: "DELETE",
      body: { coarseScope: "MEP Rough", finerScope: "Electrical Rough" },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("renders the server's message and does not refresh when the call fails", async () => {
    stubFetch({ ok: false, body: { error: { message: "Admin access required." } } });
    render(<SplitRulesPanel rules={rules} isAdmin />);
    fireEvent.click(screen.getByText("Electrical Rough ×"));

    await waitFor(() => expect(screen.getByText("Admin access required.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

Create `tests/components/DictionaryPanel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch } from "../helpers/renderClient";
import { DictionaryPanel } from "@/components/DictionaryPanel";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const rows = [{ rawName: "Hang Drywall L2", canonicalScope: "Hang Drywall", count: 4 }];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("DictionaryPanel", () => {
  it("offers no Unmap button to a non-admin", () => {
    render(<DictionaryPanel rows={rows} isAdmin={false} />);
    expect(screen.queryByText("Unmap")).toBeNull();
  });

  it("unmaps by raw name", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<DictionaryPanel rows={rows} isAdmin />);
    fireEvent.click(screen.getByText("Unmap"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/normalize",
      method: "DELETE",
      body: { rawName: "Hang Drywall L2" },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("surfaces a failure message", async () => {
    stubFetch({ ok: false, body: { error: { message: "Admin access required." } } });
    render(<DictionaryPanel rows={rows} isAdmin />);
    fireEvent.click(screen.getByText("Unmap"));
    await waitFor(() => expect(screen.getByText("Admin access required.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/components/SplitRulesPanel.test.tsx tests/components/DictionaryPanel.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/components/SplitRulesPanel.test.tsx tests/components/DictionaryPanel.test.tsx
git commit -m "test: characterise the split-rule and dictionary panels

Locks the request shape, the failure message and the refresh-on-success so the
fetch refactor that follows can be shown to change nothing."
```

---

### Task 3: Characterise the batch-save panels

`CoarsePanel` and `NormalizePanel` both collect edits and save them in one action. `CoarsePanel` fires one request per finer scope and reports only the first failure; `NormalizePanel` sends one request carrying all mappings.

**Files:**
- Create: `tests/components/CoarsePanel.test.tsx`, `tests/components/NormalizePanel.test.tsx`

**Interfaces:**
- Consumes: `stubFetch`, plus the `vi.hoisted` router preamble from Task 1
- Produces: nothing

- [ ] **Step 1: Write both test files**

Create `tests/components/CoarsePanel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch } from "../helpers/renderClient";
import { CoarsePanel } from "@/components/CoarsePanel";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const rows = [{ name: "MEP OH Rough-In", count: 8, finerScopes: [] }];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("CoarsePanel", () => {
  it("tells a non-admin they cannot mark scopes, and offers no input", () => {
    render(<CoarsePanel rows={rows} isAdmin={false} />);
    expect(screen.getByText(/Only an admin can mark scopes as coarse/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Too coarse\?/i)).toBeNull();
  });

  it("posts one rule per comma-separated finer scope, keyed on the raw name", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<CoarsePanel rows={rows} isAdmin />);
    fireEvent.change(screen.getByPlaceholderText(/Too coarse\?/i), {
      target: { value: "Electrical Rough, Plumbing Rough" },
    });
    fireEvent.click(screen.getByText("Save coarse markings"));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => c.body)).toEqual([
      { coarseScope: "MEP OH Rough-In", finerScope: "Electrical Rough" },
      { coarseScope: "MEP OH Rough-In", finerScope: "Plumbing Rough" },
    ]);
    expect(calls[0]).toMatchObject({ url: "/api/completeness/split-rules", method: "POST" });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("reports the server's refusal instead of failing silently", async () => {
    stubFetch({ ok: false, body: { error: { message: "Admin access required." } } });
    render(<CoarsePanel rows={rows} isAdmin />);
    fireEvent.change(screen.getByPlaceholderText(/Too coarse\?/i), { target: { value: "A" } });
    fireEvent.click(screen.getByText("Save coarse markings"));

    await waitFor(() => expect(screen.getByText("Admin access required.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("disables Save until something is typed", () => {
    render(<CoarsePanel rows={rows} isAdmin />);
    const save = screen.getByText("Save coarse markings") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("filters the name list by the search box", () => {
    render(<CoarsePanel rows={[...rows, { name: "Hang Drywall", count: 2, finerScopes: [] }]} isAdmin={false} />);
    fireEvent.change(screen.getByPlaceholderText("Search activity names"), { target: { value: "drywall" } });
    expect(screen.queryByText("MEP OH Rough-In")).toBeNull();
    expect(screen.getByText("Hang Drywall")).toBeTruthy();
  });
});
```

Create `tests/components/NormalizePanel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch } from "../helpers/renderClient";
import { NormalizePanel } from "@/components/NormalizePanel";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const rows = [{ rawName: "Hang Drywall L2", count: 3, suggestions: ["Hang Drywall"] }];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("NormalizePanel", () => {
  it("sends one mapping per confirmed name", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<NormalizePanel rows={rows} knownScopes={["Hang Drywall"]} />);
    fireEvent.click(screen.getByText("Hang Drywall"));   // suggestion chip
    fireEvent.click(screen.getByText("Save mappings"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/normalize",
      method: "POST",
      body: { mappings: [{ rawName: "Hang Drywall L2", canonicalScope: "Hang Drywall" }] },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("maps a name to itself with Use as-is", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<NormalizePanel rows={rows} knownScopes={[]} />);
    fireEvent.click(screen.getByText("Use as-is"));
    fireEvent.click(screen.getByText("Save mappings"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect((calls[0].body as { mappings: unknown[] }).mappings).toEqual([
      { rawName: "Hang Drywall L2", canonicalScope: "Hang Drywall L2" },
    ]);
  });

  it("sends nothing for a name left blank", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<NormalizePanel rows={rows} knownScopes={[]} />);
    fireEvent.click(screen.getByText("Save mappings"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect((calls[0].body as { mappings: unknown[] }).mappings).toEqual([]);
  });

  it("shows the server's message on failure", async () => {
    stubFetch({ ok: false, body: { error: { message: "mappings array required." } } });
    render(<NormalizePanel rows={rows} knownScopes={[]} />);
    fireEvent.click(screen.getByText("Save mappings"));
    await waitFor(() => expect(screen.getByText("mappings array required.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/components/CoarsePanel.test.tsx tests/components/NormalizePanel.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/components/CoarsePanel.test.tsx tests/components/NormalizePanel.test.tsx
git commit -m "test: characterise the coarse-marking and naming panels

Covers the per-scope fan-out, the empty-input cases, and that a rejected write
reports the server's own message rather than a generic failure."
```

---

### Task 4: Characterise the granularity issues table

This one gates a destructive action on `window.confirm` and states the blast radius. Note the current `dismiss` handler does **not** check `res.ok` — characterise that as it is; changing it is out of scope for this plan.

**Files:**
- Create: `tests/components/CompletenessIssuesTable.test.tsx`

**Interfaces:**
- Consumes: `stubFetch`, `stubConfirm`, plus the `vi.hoisted` router preamble from Task 1
- Produces: nothing

- [ ] **Step 1: Write the test file**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch, stubConfirm } from "../helpers/renderClient";
import { CompletenessIssuesTable } from "@/components/CompletenessIssuesTable";
import type { CompletenessIssue } from "@/lib/completeness/completenessChecks";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const issue = (key: string): CompletenessIssue => ({
  canonicalActivityKey: key,
  externalId: 1,
  wbsCode: "1.1",
  name: "MEP OH Rough-In",
  coarseScope: "MEP OH Rough-In",
  finerScopes: ["Electrical Rough", "Plumbing Rough"],
});
const issues = [issue("a|1"), issue("a|2")];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("CompletenessIssuesTable", () => {
  it("accepts by coarse scope, not by activity key", async () => {
    stubConfirm(true);
    const { calls } = stubFetch({ ok: true });
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.click(screen.getAllByText("Accept")[0]);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/completeness/accept",
      method: "POST",
      body: { projectId: "p1", coarseScope: "MEP OH Rough-In" },
    });
    expect((calls[0].body as Record<string, unknown>).canonicalActivityKey).toBeUndefined();
  });

  it("states the real blast radius in the confirmation", async () => {
    const confirmMock = stubConfirm(true);
    stubFetch({ ok: true });
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.click(screen.getAllByText("Accept")[0]);

    const asked = String(confirmMock.mock.calls[0][0]);
    expect(asked).toContain("2 activities");   // both flagged instances
    expect(asked).toContain("4 tasks");        // 2 activities x 2 finer scopes
    expect(asked).toContain("dismissed are left alone");
  });

  it("fires no request when the confirmation is declined", async () => {
    stubConfirm(false);
    const { calls } = stubFetch({ ok: true });
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.click(screen.getAllByText("Accept")[0]);

    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a failed accept", async () => {
    stubConfirm(true);
    stubFetch({ ok: false, body: { error: { message: "No split rule found for this coarse scope." } } });
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.click(screen.getAllByText("Accept")[0]);
    await waitFor(() => expect(screen.getByText("No split rule found for this coarse scope.")).toBeTruthy());
  });

  it("dismisses one activity by its own key", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.click(screen.getAllByText("Dismiss")[0]);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/completeness/dismiss",
      method: "POST",
      body: { projectId: "p1", canonicalActivityKey: "a|1", coarseScope: "MEP OH Rough-In" },
    });
  });

  it("filters by coarse scope", () => {
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.change(screen.getByPlaceholderText("Search name / WBS / ID"), { target: { value: "nomatch" } });
    expect(screen.getByText("0 flagged activities")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/components/CompletenessIssuesTable.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/components/CompletenessIssuesTable.test.tsx
git commit -m "test: characterise the granularity issues table

Includes the two cases nothing covered: that declining the confirmation fires no
request, and that the dialog's stated blast radius matches what the backend will
actually replace."
```

---

### Task 5: Characterise the trades panel

Four call sites in one component, plus the tab ordering and the single-partner pre-selection that were added without tests.

**Files:**
- Create: `tests/components/TradesPanel.test.tsx`

**Interfaces:**
- Consumes: `stubFetch`, plus the `vi.hoisted` router preamble from Task 1
- Produces: nothing

Note: `TradesPanel` returns an early placeholder when `disciplines` is empty, so every test must pass at least one discipline.

- [ ] **Step 1: Write the test file**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch } from "../helpers/renderClient";
import { TradesPanel } from "@/components/TradesPanel";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const disciplines = [{ id: 26, name: "26A: ELECTRICAL", division: "" }];
const base = {
  projectId: "p1",
  disciplineRows: [],
  assignmentRows: [],
  disciplines,
  dismissedScopes: [] as string[],
  driftRows: [],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("TradesPanel", () => {
  it("explains itself when the project has no roster", () => {
    render(<TradesPanel {...base} disciplines={[]} />);
    expect(screen.getByText(/No trade partners for this project yet/i)).toBeTruthy();
  });

  it("opens on Unmapped Activities while anything is unmapped", () => {
    render(<TradesPanel {...base} disciplineRows={[{ canonicalScope: "Pull Wire", suggestions: disciplines }]} />);
    expect(screen.getByText("Scope → discipline (global)")).toBeTruthy();
  });

  it("opens on Trade Assignment once nothing is unmapped", () => {
    render(<TradesPanel {...base} />);
    expect(screen.getByText("Discipline → trade partner (this project)")).toBeTruthy();
  });

  it("pre-selects the only partner covering a discipline", () => {
    render(
      <TradesPanel
        {...base}
        assignmentRows={[{
          osDisciplineId: 26, disciplineName: "26A: ELECTRICAL", currentPartnerId: null,
          currentPartnerName: "", onRoster: true, partners: [{ osPartnerId: 77, name: "Amber" }],
        }]}
      />,
    );
    expect(screen.getByText(/selected for you, Save to confirm/i)).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("77");
  });

  it("saves the pre-selected assignment", async () => {
    const { calls } = stubFetch({ ok: true });
    render(
      <TradesPanel
        {...base}
        assignmentRows={[{
          osDisciplineId: 26, disciplineName: "26A: ELECTRICAL", currentPartnerId: null,
          currentPartnerName: "", onRoster: true, partners: [{ osPartnerId: 77, name: "Amber" }],
        }]}
      />,
    );
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "/api/trades", method: "POST" });
    expect(calls[0].body).toMatchObject({
      projectId: "p1",
      assignments: [{ osDisciplineId: 26, osPartnerId: 77 }],
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("dismisses a scope", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<TradesPanel {...base} disciplineRows={[{ canonicalScope: "Pull Wire", suggestions: [] }]} />);
    fireEvent.click(screen.getByText("Dismiss"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/trades/dismiss",
      method: "POST",
      body: { projectId: "p1", canonicalScope: "Pull Wire" },
    });
  });

  it("restores a dismissed scope", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<TradesPanel {...base} dismissedScopes={["Pull Wire"]} />);
    fireEvent.click(screen.getByText(`Dismissed (1)`));
    fireEvent.click(screen.getByText("Restore"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/trades/restore",
      method: "POST",
      body: { projectId: "p1", canonicalScope: "Pull Wire" },
    });
  });

  it("accepts a drift row's file value", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<TradesPanel {...base} driftRows={[{
      osDisciplineId: 26, disciplineName: "26A: ELECTRICAL",
      fileValue: "Facility Solutions", toolValue: "Amber", activityCount: 3,
    }]} />);
    fireEvent.click(screen.getByText("Changed in MS Project (1)"));
    fireEvent.click(screen.getByText("Accept file"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/trades/drift",
      method: "POST",
      body: { projectId: "p1", osDisciplineId: 26, fileValue: "Facility Solutions", action: "accept" },
    });
  });

  it("keeps the tool's value with action keep", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<TradesPanel {...base} driftRows={[{
      osDisciplineId: 26, disciplineName: "26A: ELECTRICAL",
      fileValue: "Facility Solutions", toolValue: "Amber", activityCount: 1,
    }]} />);
    fireEvent.click(screen.getByText("Changed in MS Project (1)"));
    fireEvent.click(screen.getByText("Keep this one"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect((calls[0].body as Record<string, unknown>).action).toBe("keep");
  });

  it("reports an off-roster refusal from the drift route", async () => {
    stubFetch({ ok: false, body: { error: { message: '"Nobody Ltd" is not a trade partner on this project in Skiles Connect.' } } });
    render(<TradesPanel {...base} driftRows={[{
      osDisciplineId: 26, disciplineName: "26A: ELECTRICAL",
      fileValue: "Nobody Ltd", toolValue: "Amber", activityCount: 1,
    }]} />);
    fireEvent.click(screen.getByText("Changed in MS Project (1)"));
    fireEvent.click(screen.getByText("Accept file"));

    await waitFor(() => expect(screen.getByText(/is not a trade partner on this project/)).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/components/TradesPanel.test.tsx`
Expected: PASS, 11 tests.

- [ ] **Step 3: Commit**

```bash
git add tests/components/TradesPanel.test.tsx
git commit -m "test: characterise the trades panel's four write paths

Also covers the tab default and the single-partner pre-selection, both of which
shipped without a test."
```

---

### Task 6: Characterise the lookahead update form

Two chained requests: entries, then optionally finalize. The finalize call sends no JSON body, so the refactor in Phase C must leave it alone.

**Files:**
- Create: `tests/components/LookaheadUpdateForm.test.tsx`

**Interfaces:**
- Consumes: `stubFetch`, plus the `vi.hoisted` router preamble from Task 1
- Produces: nothing

The component's two buttons are labelled **`Save draft`** (`save(false)`) and
**`Finalize`** (`save(true)`), and both are hidden entirely when `readOnly` is
true. `Finalize` fires a second request to `/api/updates/{id}/finalize` with no
JSON body.

- [ ] **Step 1: Write the test file**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch } from "../helpers/renderClient";
import { LookaheadUpdateForm, type LookaheadFormRow } from "@/components/LookaheadUpdateForm";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const row: LookaheadFormRow = {
  externalUid: 7,
  canonicalActivityKey: "1.1|hang drywall",
  wbsCode: "1.1",
  name: "Hang Drywall",
  type: "task",
  plannedStart: "2026-08-01",
  plannedFinish: "2026-08-05",
  slippage: "on-track",
  status: "not_started",
  actualStart: "",
  actualFinish: "",
  percentComplete: null,
  note: "",
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("LookaheadUpdateForm", () => {
  it("posts every row's entry to the update's entries endpoint", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={[row]} readOnly={false} />);
    fireEvent.click(screen.getByText("Save draft"));

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    expect(calls[0]).toMatchObject({ url: "/api/updates/u1/entries", method: "POST" });
    const entries = (calls[0].body as { entries: Record<string, unknown>[] }).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ activityExternalUid: 7, canonicalActivityKey: "1.1|hang drywall" });
  });

  it("normalises completed_as_planned to complete before sending", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={[{ ...row, status: "completed_as_planned" }]} readOnly={false} />);
    fireEvent.click(screen.getByText("Save draft"));

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    const entries = (calls[0].body as { entries: Record<string, unknown>[] }).entries;
    expect(entries[0].status).toBe("complete");
  });

  it("sends empty strings as null", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={[row]} readOnly={false} />);
    fireEvent.click(screen.getByText("Save draft"));

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    const entries = (calls[0].body as { entries: Record<string, unknown>[] }).entries;
    expect(entries[0].actualStart).toBeNull();
    expect(entries[0].note).toBeNull();
  });

  it("shows a failure message and does not refresh", async () => {
    stubFetch({ ok: false, body: {} });
    render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={[row]} readOnly={false} />);
    fireEvent.click(screen.getByText("Save draft"));
    await waitFor(() => expect(screen.getByText("Failed to save.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("chains a finalize request after saving entries", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={[row]} readOnly={false} />);
    fireEvent.click(screen.getByText("Finalize"));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ url: "/api/updates/u1/finalize", method: "POST" });
    // No JSON body on this one — Phase C must leave it as a plain fetch.
    expect(calls[1].body).toBeUndefined();
  });

  it("hides both buttons when read-only", () => {
    render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={[row]} readOnly />);
    expect(screen.queryByText("Save draft")).toBeNull();
    expect(screen.queryByText("Finalize")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/components/LookaheadUpdateForm.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 3: Run the whole suite**

Run: `npm run test && npm run build`
Expected: everything passes; build compiles.

- [ ] **Step 4: Commit**

```bash
git add tests/components/LookaheadUpdateForm.test.tsx
git commit -m "test: characterise the lookahead update form

Covers the status normalisation and empty-string-to-null conversion that the
progress API depends on."
```

---

### Task 7: Extract sendJson and convert the eleven call sites

**Files:**
- Modify: `lib/http.ts`
- Create: `tests/http.test.ts`
- Modify: `components/TradesPanel.tsx`, `components/CompletenessIssuesTable.tsx`, `components/CoarsePanel.tsx`, `components/DictionaryPanel.tsx`, `components/SplitRulesPanel.tsx`, `components/NormalizePanel.tsx`, `components/LookaheadUpdateForm.tsx`

**Interfaces:**
- Consumes: the Phase B characterisation tests as the safety net
- Produces: `sendJson(path: string, body: unknown, method?: string): Promise<string | null>` — resolves to `null` on success, or the server's error message

**Success criterion: every Phase B test passes without being edited.** If a test needs changing, the refactor altered behaviour — stop and report rather than adjusting the test.

- [ ] **Step 1: Write the helper's test**

Create `tests/http.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { sendJson } from "@/lib/http";

afterEach(() => vi.unstubAllGlobals());

describe("sendJson", () => {
  it("posts JSON and resolves null on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendJson("/api/thing", { a: 1 })).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/thing");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ a: 1 });
  });

  it("returns the server's error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ error: { message: "Admin access required." } }),
    }));
    expect(await sendJson("/api/thing", {})).toBe("Admin access required.");
  });

  it("falls back to a generic message when the body carries none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await sendJson("/api/thing", {})).toBe("Request failed.");
  });

  it("does not throw when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, json: async () => { throw new Error("not json"); },
    }));
    expect(await sendJson("/api/thing", {})).toBe("Request failed.");
  });

  it("honours an explicit method", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await sendJson("/api/thing", { a: 1 }, "DELETE");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/http.test.ts`
Expected: FAIL — `sendJson` is not exported from `@/lib/http`.

- [ ] **Step 3: Add the helper**

Append to `lib/http.ts`:

```ts
// Every client write in this app has the same shape: POST or DELETE some JSON,
// and on failure show the server's own message rather than a generic one. The
// caller keeps its busy state and its fallback wording; this owns the transport.
export async function sendJson(path: string, body: unknown, method = "POST"): Promise<string | null> {
  const res = await fetch(appPath(path), {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  try {
    return ((await res.json())?.error?.message as string | undefined) ?? "Request failed.";
  } catch {
    // A non-JSON error body must not mask the failure it came with.
    return "Request failed.";
  }
}
```

- [ ] **Step 4: Verify the helper**

Run: `npx vitest run tests/http.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Convert each call site**

In each of the seven components, replace the fetch block. The shape before:

```ts
    const res = await fetch(appPath("/api/trades/restore"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, canonicalScope: scope }),
    });
    setRowBusy(null);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Restore failed.");
      return;
    }
    router.refresh();
```

and after:

```ts
    const err = await sendJson("/api/trades/restore", { projectId, canonicalScope: scope });
    setRowBusy(null);
    if (err) {
      setError(err);
      return;
    }
    router.refresh();
```

Preserve each site's own busy-state handling and ordering exactly. Where a call site passed a bespoke fallback string (`"Restore failed."`, `Could not mark "${name}"`), that string is now unreachable because the helper supplies the fallback — delete it rather than leaving it dangling. Update the `appPath` import to `sendJson` where `appPath` becomes unused; leave it imported where `FormData` sites still need it.

`CoarsePanel` collects failures in a loop — keep that structure, pushing `err` instead of the parsed message. `LookaheadUpdateForm`'s second request (`/finalize`) sends no JSON body and must be left as a plain `fetch`.

- [ ] **Step 6: Prove the refactor changed nothing**

Run: `npm run test`
Expected: every Phase B test passes **with no edits to any test file**. Then `npx tsc --noEmit` and `npm run build` clean.

- [ ] **Step 7: Commit**

```bash
git add lib/http.ts tests/http.test.ts components
git commit -m "refactor(components): one sendJson for eleven identical write paths

Every client write repeated the same fetch, the same JSON headers, and the same
error-message extraction — twelve copies of the latter. The helper owns the
transport; call sites keep their own busy state.

The characterisation tests added first passed unchanged, which is what makes
this provably behaviour-preserving rather than merely compiling."
```

---

### Task 8: Extract BusyButton

**Files:**
- Create: `components/BusyButton.tsx`
- Modify: `components/TradesPanel.tsx`, `components/CompletenessIssuesTable.tsx`

**Interfaces:**
- Consumes: nothing from Task 7
- Produces: `<BusyButton busy label busyLabel? onClick className? />`

- [ ] **Step 1: Create the component**

```tsx
"use client";

/** The disabled-while-in-flight button repeated across the trade and granularity tables. */
export function BusyButton({
  busy,
  label,
  busyLabel = "Working…",
  onClick,
  className = "",
}: {
  busy: boolean;
  label: string;
  busyLabel?: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button disabled={busy} onClick={onClick} className={`disabled:opacity-50 ${className}`}>
      {busy ? busyLabel : label}
    </button>
  );
}
```

- [ ] **Step 2: Convert the six sites**

Replace each `<button disabled={busy} …>{busy ? "Working…" : "X"}</button>` with `<BusyButton busy={busy} label="X" onClick={…} className="…" />`, moving the existing Tailwind classes into `className` and dropping the now-duplicated `disabled:opacity-50`. Four sites in `TradesPanel.tsx`, two in `CompletenessIssuesTable.tsx`.

- [ ] **Step 3: Prove nothing changed**

Run: `npm run test`
Expected: Phase B tests pass unchanged — they query by the button's text, which `BusyButton` still renders. Then `npx tsc --noEmit` and `npm run build` clean.

- [ ] **Step 4: Commit**

```bash
git add components/BusyButton.tsx components/TradesPanel.tsx components/CompletenessIssuesTable.tsx
git commit -m "refactor(components): one BusyButton for six copies of the same markup"
```

---

### Task 9: Cover the login and health routes

`/api/login` decides who gets an elevated session, and nothing tests it. `/api/health` is three lines and cheap to include.

**Files:**
- Create: `tests/api/login.test.ts`, `tests/api/health.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Write the login test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { SESSION_COOKIE, ADMIN_SESSION_COOKIE } from "@/lib/auth";

beforeEach(() => {
  process.env.APP_PASSWORD = "secret123";
  process.env.APP_ADMIN_PASSWORD = "adminsecret456";
  process.env.APP_SESSION_TOKEN = "token-abc";
});

function post(password: string) {
  const form = new FormData();
  form.append("password", password);
  return new Request("http://localhost/api/login", { method: "POST", body: form });
}

describe("login route", () => {
  it("sets the session cookie and no admin cookie for the shared password", async () => {
    const { POST } = await import("@/app/api/login/route");
    const res = await POST(post("secret123"));
    expect(res.status).toBe(303);
    const cookies = res.headers.getSetCookie().join("; ");
    expect(cookies).toContain(`${SESSION_COOKIE}=token-abc`);
    expect(cookies).not.toContain(ADMIN_SESSION_COOKIE);
  });

  it("sets both cookies for the admin password", async () => {
    const { POST } = await import("@/app/api/login/route");
    const cookies = (await POST(post("adminsecret456"))).headers.getSetCookie().join("; ");
    expect(cookies).toContain(`${SESSION_COOKIE}=token-abc`);
    expect(cookies).toContain(`${ADMIN_SESSION_COOKIE}=token-abc`);
  });

  it("redirects with an error and sets no cookie for a wrong password", async () => {
    const { POST } = await import("@/app/api/login/route");
    const res = await POST(post("nope"));
    expect(res.headers.get("location")).toContain("error=1");
    expect(res.headers.getSetCookie().join("; ")).not.toContain(SESSION_COOKIE);
  });

  it("refuses an empty password even when APP_PASSWORD is unset", async () => {
    process.env.APP_PASSWORD = "";
    process.env.APP_ADMIN_PASSWORD = "";
    const { POST } = await import("@/app/api/login/route");
    expect((await POST(post(""))).headers.get("location")).toContain("error=1");
  });
});
```

- [ ] **Step 2: Write the health test**

`GET` takes no arguments and returns `Response.json({ status: "ok" })`.

```ts
import { describe, it, expect } from "vitest";

describe("health route", () => {
  it("answers 200 with ok so the OS health check passes", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 3: Run and commit**

Run: `npx vitest run tests/api/login.test.ts tests/api/health.test.ts`
Expected: PASS.

```bash
git add tests/api/login.test.ts tests/api/health.test.ts
git commit -m "test: cover the login and health routes

Login decides who gets an elevated session and had no test; the assertion that
matters is that a non-admin password sets no admin cookie."
```

---

### Task 10: Cover the OS context route

`verifyCallback` and `buildScheduleContextPacket` are both tested; the route that wires them — and rejects unknown packet types — is not. This is the endpoint Skiles Connect calls.

**Files:**
- Create: `tests/os-context/route.test.ts`

**Interfaces:**
- Consumes: `CALLBACK_SIGNATURE_HEADER` from `@/lib/os-context/verifyCallback`, `SCHEDULE_PACKET_TYPE` from `@/lib/os-context/scheduleContextPacket`
- Produces: nothing

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { CALLBACK_SIGNATURE_HEADER } from "@/lib/os-context/verifyCallback";
import { SCHEDULE_PACKET_TYPE } from "@/lib/os-context/scheduleContextPacket";

const SECRET = "test-context-secret";

beforeEach(() => {
  process.env.SCHEDULE_MANAGER_CONTEXT_SECRET = SECRET;
});

function signed(payload: Record<string, unknown>, secret = SECRET) {
  const body = JSON.stringify(payload);
  return new Request("http://localhost/api/os-context", {
    method: "POST",
    headers: { [CALLBACK_SIGNATURE_HEADER]: createHmac("sha256", secret).update(body).digest("base64url") },
    body,
  });
}

const valid = (over: Record<string, unknown> = {}) => ({
  packetType: SCHEDULE_PACKET_TYPE,
  requestingTool: "procurement-manager",
  projectId: 999999,
  personId: 4,
  accessRole: "Project Manager",
  limit: 25,
  issuedAt: new Date(Date.now() - 1000).toISOString(),
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  ...over,
});

describe("os-context route", () => {
  it("rejects an unsigned request", async () => {
    const { POST } = await import("@/app/api/os-context/route");
    const res = await POST(new Request("http://localhost/api/os-context", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const { POST } = await import("@/app/api/os-context/route");
    expect((await POST(signed(valid(), "wrong-secret"))).status).toBe(401);
  });

  it("rejects an expired callback", async () => {
    const { POST } = await import("@/app/api/os-context/route");
    const res = await POST(signed(valid({ expiresAt: new Date(Date.now() - 1000).toISOString() })));
    expect(res.status).toBe(401);
  });

  it("rejects a packet type this tool does not expose", async () => {
    const { POST } = await import("@/app/api/os-context/route");
    const res = await POST(signed(valid({ packetType: "procurement_project_summary" })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("procurement_project_summary");
  });

  it("reports a misconfigured secret as a server error, not a bad caller", async () => {
    delete process.env.SCHEDULE_MANAGER_CONTEXT_SECRET;
    const { POST } = await import("@/app/api/os-context/route");
    const res = await POST(new Request("http://localhost/api/os-context", {
      method: "POST", headers: { [CALLBACK_SIGNATURE_HEADER]: "x" }, body: "{}",
    }));
    expect(res.status).toBe(500);
  });

  it("returns an empty packet with a warning for an unlinked project", async () => {
    const { POST } = await import("@/app/api/os-context/route");
    const res = await POST(signed(valid()));
    expect(res.status).toBe(200);
    const packet = await res.json();
    expect(packet.packetType).toBe(SCHEDULE_PACKET_TYPE);
    expect(packet.items).toEqual([]);
    expect(packet.warnings.length).toBeGreaterThan(0);
  });
});
```

The last case needs a database connection but no fixture — project id `999999` is deliberately unlinked. If `DATABASE_URL` is unset in the environment, wrap only that final case in `it.runIf(!!process.env.DATABASE_URL)`.

- [ ] **Step 2: Run and commit**

Run: `npx vitest run tests/os-context/route.test.ts`
Expected: PASS.

```bash
git add tests/os-context/route.test.ts
git commit -m "test: cover the OS context callback route

Both halves were tested; the wiring Connect actually calls was not — including
that an unexposed packet type is refused and a missing secret reports 500 rather
than blaming the caller."
```

---

### Task 11: Cover the remaining write routes

**Files:**
- Create: `tests/api/projects.test.ts`, `tests/api/updates.test.ts`, `tests/api/importsPreview.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

All three are database-backed: use `describe.runIf(hasDb)` and a `30000` ms timeout, and delete anything created.

- [ ] **Step 1: Write the projects route test**

`POST /api/projects` takes **FormData**, refuses outright inside a scoped session
(403), redirects to `/projects/new?error=1` when the name is blank, and otherwise
creates the project and redirects to it (303).

Create `tests/api/projects.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("projects route", () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) await prisma.project.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });

  function post(fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return new Request("http://localhost/api/projects", { method: "POST", body: form });
  }

  it("creates a project and redirects to it", async () => {
    const { POST } = await import("@/app/api/projects/route");
    const name = `ZZ Route Project ${Date.now()}`;
    const res = await POST(post({ name, client: "BSW" }));
    expect(res.status).toBe(303);

    const project = await prisma.project.findFirstOrThrow({ where: { name } });
    created.push(project.id);
    expect(res.headers.get("location")).toContain(project.id);
    expect(project.client).toBe("BSW");
  }, 30000);

  it("redirects with an error and creates nothing when the name is blank", async () => {
    const { POST } = await import("@/app/api/projects/route");
    const before = await prisma.project.count();
    const res = await POST(post({ name: "   " }));
    expect(res.headers.get("location")).toContain("error=1");
    expect(await prisma.project.count()).toBe(before);
  }, 30000);

  it("turns blank optional fields into null rather than empty strings", async () => {
    const { POST } = await import("@/app/api/projects/route");
    const name = `ZZ Route Blanks ${Date.now()}`;
    await POST(post({ name, client: "", sector: "" }));
    const project = await prisma.project.findFirstOrThrow({ where: { name } });
    created.push(project.id);
    expect(project.client).toBeNull();
    expect(project.sector).toBeNull();
  }, 30000);

  it("lists every project for an unscoped session", async () => {
    const { GET } = await import("@/app/api/projects/route");
    const res = await GET(new Request("http://localhost/api/projects"));
    expect(Array.isArray(await res.json())).toBe(true);
  }, 30000);
});
```

- [ ] **Step 2: Write the updates and finalize test**

`POST /api/updates` takes FormData (`projectId`, optional `asOfDate`,
`lookaheadWeeks` clamped to 1/3/6), redirects to the draft on success and to `/`
when `projectId` is missing. `POST /api/updates/[updateId]/finalize` returns 404
for an unknown id, 200 on success, and 422 with a message when `finalizeUpdate`
throws.

Create `tests/api/updates.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { commitImport } from "@/lib/import/commitImport";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");
const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("updates routes", () => {
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) await prisma.project.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });

  async function projectWithImport() {
    const project = await prisma.project.create({ data: { name: `ZZ Updates Route ${Date.now()}` } });
    created.push(project.id);
    await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });
    return project.id;
  }

  function post(fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return new Request("http://localhost/api/updates", { method: "POST", body: form });
  }

  it("creates a draft and redirects to it", async () => {
    const projectId = await projectWithImport();
    const { POST } = await import("@/app/api/updates/route");
    const res = await POST(post({ projectId, asOfDate: "2026-06-18", lookaheadWeeks: "3" }));
    expect(res.status).toBe(303);

    const draft = await prisma.progressUpdate.findFirstOrThrow({ where: { projectId } });
    expect(draft.state).toBe("draft");
    expect(draft.lookaheadWeeks).toBe(3);
    expect(res.headers.get("location")).toContain(draft.id);
  }, 30000);

  it("falls back to a 3-week lookahead for an unsupported value", async () => {
    const projectId = await projectWithImport();
    const { POST } = await import("@/app/api/updates/route");
    await POST(post({ projectId, asOfDate: "2026-06-18", lookaheadWeeks: "5" }));
    const draft = await prisma.progressUpdate.findFirstOrThrow({ where: { projectId } });
    expect(draft.lookaheadWeeks).toBe(3);
  }, 30000);

  it("redirects home when projectId is missing", async () => {
    const { POST } = await import("@/app/api/updates/route");
    const res = await POST(post({ asOfDate: "2026-06-18" }));
    expect(res.status).toBe(303);
    expect(await prisma.progressUpdate.count({ where: { projectId: "" } })).toBe(0);
  }, 30000);

  it("finalize returns 404 for an unknown update", async () => {
    const { POST } = await import("@/app/api/updates/[updateId]/finalize/route");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ updateId: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe("Update not found.");
  }, 30000);

  it("finalize marks the update finalized", async () => {
    const projectId = await projectWithImport();
    const { POST: createDraft } = await import("@/app/api/updates/route");
    await createDraft(post({ projectId, asOfDate: "2026-06-18", lookaheadWeeks: "3" }));
    const draft = await prisma.progressUpdate.findFirstOrThrow({ where: { projectId } });

    const { POST } = await import("@/app/api/updates/[updateId]/finalize/route");
    const res = await POST(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ updateId: draft.id }),
    });
    expect(res.status).toBe(200);
    const after = await prisma.progressUpdate.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.state).toBe("finalized");
    expect(after.finalizedAt).not.toBeNull();
  }, 30000);
});
```

- [ ] **Step 3: Write the import preview test**

`POST /api/imports/preview` returns 400 with `"No file uploaded."` when the form
carries no file, 422 with a message when parsing throws, and otherwise the title,
status date, counts, field definitions and `suggestedIsBaseline`. It must write
nothing.

Create `tests/api/importsPreview.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");
const hasDb = !!process.env.DATABASE_URL;

function post(body: FormData) {
  return new Request("http://localhost/api/imports/preview", { method: "POST", body });
}

describe("imports preview route", () => {
  afterAll(async () => { if (hasDb) await prisma.$disconnect(); });

  it("rejects a form with no file", async () => {
    const { POST } = await import("@/app/api/imports/preview/route");
    const res = await POST(post(new FormData()));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe("No file uploaded.");
  });

  it("reports the title, counts and field definitions", async () => {
    const form = new FormData();
    form.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
    const { POST } = await import("@/app/api/imports/preview/route");
    const res = await POST(post(form));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.title).toBe("Minimal Test Schedule");
    expect(data.counts.activities).toBeGreaterThan(0);
    // The fixture declares Text1 aliased "Phoenix ID".
    expect(data.fieldDefinitions.map((f: { alias: string }) => f.alias)).toContain("Phoenix ID");
  });

  it("rejects unparseable input with 422", async () => {
    const form = new FormData();
    form.append("file", new File(["not xml at all"], "bad.xml", { type: "application/xml" }));
    const { POST } = await import("@/app/api/imports/preview/route");
    expect((await POST(post(form))).status).toBe(422);
  });

  it.runIf(hasDb)("writes nothing", async () => {
    const before = await prisma.scheduleImport.count();
    const form = new FormData();
    form.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
    const { POST } = await import("@/app/api/imports/preview/route");
    await POST(post(form));
    expect(await prisma.scheduleImport.count()).toBe(before);
  }, 30000);
});
```

If the fixture's project title is not exactly `Minimal Test Schedule`, take the
value from `tests/fixtures/minimal.xml` — do not weaken the assertion to a
substring match.

- [ ] **Step 4: Run and commit**

Run: `npm run test`
Expected: all pass.

```bash
git add tests/api
git commit -m "test: cover project creation, progress updates and import preview

Preview asserts it writes nothing, which is the property that makes it safe to
run against a real schedule before committing an import. Finalize asserts the
404 path, which is what stops an unknown id being treated as a scope failure."
```

---

### Task 12: Cover the OS gateway client

`lib/os-gateway.ts` is exercised only incidentally through the launch route's fetch stub. Its own comments warn that a base URL not ending in `/api` "fails silently at launch" — that rule has no test.

**Files:**
- Create: `tests/trades/osGateway.test.ts`

**Interfaces:**
- Consumes: `getProjectContext`, `getTradePartners` from `@/lib/os-gateway`
- Produces: nothing

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getProjectContext, getTradePartners } from "@/lib/os-gateway";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { process.env.SKILES_OS_API_BASE_URL = "https://api.example.com/api"; });

function stub(ok: boolean, body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 401, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("os-gateway", () => {
  it("appends /tool-gateway to the configured base and sends the bearer token", async () => {
    const fetchMock = stub(true, { project: { id: 1, name: "P" } });
    await getProjectContext("tok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/tool-gateway/project-context");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.cache).toBe("no-store");
  });

  it("tolerates a trailing slash on the base url", async () => {
    process.env.SKILES_OS_API_BASE_URL = "https://api.example.com/api/";
    const fetchMock = stub(true, {});
    await getTradePartners("tok");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/api/tool-gateway/trade-partners");
  });

  it("throws a named error when the base url is unset", async () => {
    delete process.env.SKILES_OS_API_BASE_URL;
    await expect(getProjectContext("tok")).rejects.toThrow(/SKILES_OS_API_BASE_URL/);
  });

  it("throws with the status when the gateway rejects the token", async () => {
    stub(false);
    await expect(getProjectContext("expired")).rejects.toThrow(/401/);
  });
});
```

- [ ] **Step 2: Run and commit**

Run: `npx vitest run tests/trades/osGateway.test.ts`
Expected: PASS, 4 tests.

```bash
git add tests/trades/osGateway.test.ts
git commit -m "test: cover the OS gateway client's url construction

Its own comment says a base url missing /api fails silently at launch. Now it
fails a test instead."
```

---

### Task 13: The remaining audit findings

Three small cleanups, each already covered by existing tests.

**Files:**
- Modify: `lib/os-context/scheduleContextPacket.ts`, `lib/msp/types.ts`, `lib/health/dateChecks.ts`, `lib/completeness/completenessService.ts`, `lib/os-context/scheduleContextPacket.ts`, `lib/trades/tradeDrift.ts`, `lib/http.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `isLeafActive(a: { type: string; isActive: boolean }): boolean` exported from `@/lib/msp/types`

- [ ] **Step 1: Collapse the three date/number reducers**

In `lib/os-context/scheduleContextPacket.ts`, replace `earlier`, `later` and `smaller` with two generics — `earlier` and `smaller` are the same minimum over comparables:

```ts
function minOf<T extends Date | number>(current: T | null, candidate: T | null): T | null {
  if (candidate === null || candidate === undefined) return current;
  return current === null || candidate < current ? candidate : current;
}

function maxOf<T extends Date | number>(current: T | null, candidate: T | null): T | null {
  if (candidate === null || candidate === undefined) return current;
  return current === null || candidate > current ? candidate : current;
}
```

Update the three call sites: `earlier(...)` → `minOf(...)`, `later(...)` → `maxOf(...)`, `smaller(...)` → `minOf(...)`.

- [ ] **Step 2: Verify by test, not by eye**

Run: `npx vitest run tests/os-context/scheduleContextPacket.test.ts`
Expected: PASS. That suite asserts `firstActivityStart`, `lastActivityFinish` and `minFloatDays` against a seeded database, so it genuinely covers this change.

- [ ] **Step 3: De-duplicate isLeafActive**

The predicate is defined identically in `lib/health/dateChecks.ts` and `lib/completeness/completenessService.ts`. Move it to `lib/msp/types.ts`:

```ts
/**
 * A real activity: not a summary row, not the project summary, not deactivated.
 *
 * Lives here rather than beside either consumer because `completenessService`
 * imports Prisma, and a predicate this small must stay importable from anywhere
 * — including a client component, which cannot pull Prisma into its bundle.
 */
export function isLeafActive(a: { type: string; isActive: boolean }): boolean {
  return a.type !== "summary" && a.type !== "project_summary" && a.isActive;
}
```

Delete both existing definitions. Re-point every importer to `@/lib/msp/types`: `lib/health/dateChecks.ts` (internal use in `runHealthChecks`), `lib/completeness/completenessService.ts`, `lib/os-context/scheduleContextPacket.ts`, `lib/trades/tradeDrift.ts`.

**Do NOT touch** `app/projects/[id]/normalize/page.tsx`, `app/projects/[id]/trades/page.tsx` or `components/ActivityTable.tsx`. Their similar-looking filters are different predicates — the pages omit `isActive`, and `ActivityTable` checks only `summary` because it needs summary rows to build its tree. Consolidating them would change behaviour.

- [ ] **Step 4: Drop three unnecessary exports**

Remove the `export` keyword from `requestBaseUrl` (`lib/http.ts`) and from `TRADE_PARTNER_ALIAS` and `dismissalKey` (`lib/trades/tradeDrift.ts`). All three are used only inside their own module and referenced by no test.

- [ ] **Step 5: Full verification**

Run: `npx tsc --noEmit && npm run test && npm run build`
Expected: clean typecheck, all tests pass, build compiles.

- [ ] **Step 6: Commit**

```bash
git add lib
git commit -m "refactor(lib): collapse duplicated reducers and the leaf predicate

earlier() and smaller() were the same minimum over comparables. isLeafActive was
defined identically in two modules, one of which carried a comment warning that
a second copy would drift from it. It now lives in a Prisma-free module so a
client component could use it too.

The similar-looking filters in the pages and the activity table are deliberately
left alone: they are different predicates, and merging them would have silently
added an isActive filter."
```

---

## Verification checklist

- [ ] `npx tsc --noEmit` clean
- [ ] `npm run test` — all pass
- [ ] `npm run build` compiles
- [ ] Every Phase B test passed **unedited** through Tasks 7 and 8
- [ ] Rendered smoke pass: project, trades, completeness and normalize pages all return 200 with no server-log errors
- [ ] Two new dev dependencies only: `@testing-library/react`, `happy-dom`
- [ ] Component count under test: 8 of 13 (the five presentational ones remain uncovered — see below)

## Out of scope

- **Server components / pages.** They stay verified only by the rendered smoke pass; testing React Server Components needs a different harness and does not pay for itself here.
- **`ExportPanel` and `ImportWizard`.** Both post `FormData` and read success payloads — a different shape from the eleven, and not touched by Phase C.
- **`ActivityTable`, `HealthCheckSection`, `ResetProjectButton`.** Presentational or form-action based. `ActivityTable`'s filter logic is now testable with this harness and is worth a follow-up, but it is not a Phase C call site.
- **Coverage reporting.** `@vitest/coverage-v8` would replace the structural audit behind this plan with real numbers. A third dependency for a one-off measurement; decide separately.
- **`CompletenessIssuesTable`'s `dismiss` ignoring `res.ok`.** Characterised as-is in Task 4. Whether it should report failures is a behaviour question, not a cleanup.
