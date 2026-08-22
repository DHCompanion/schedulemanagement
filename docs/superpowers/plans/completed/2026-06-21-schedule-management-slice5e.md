# Slice 5e — Workflow Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sequence Normalize → Completeness → Schedule health into a real pipeline, move split-rule authoring inline so it actually gets used, push canonical names into the export XML, gate split rules to admin sessions, and walk first-time projects through a setup wizard.

**Architecture:** No new services or routes beyond what's listed below — this slice extends existing pure-check / DB-service / page-component layers already established by Slices 5a/5c/5d, plus one new column and one new tiny route. The wizard is implemented as a banner injected into the *existing* Health/Normalize/Completeness pages via a `?wizard=1` query param — there is no separate wizard route, so no page content needs to be extracted or duplicated.

**Tech Stack:** Next.js 14 (App Router), Prisma 5 + Postgres, Vitest, TypeScript strict.

## Global Constraints

- TypeScript strict mode — no `any`.
- DB-gated tests run only with `DATABASE_URL` set (`describe.runIf(hasDb)`), self-clean via `afterAll`, use a `30000`ms timeout for multi-round-trip tests.
- No DB mutation of imported `Activity` rows anywhere — normalization/export overlays stay read-time/export-time only.
- Commit per task. Run `npm run test && npm run build` before considering any task done.
- No AI/LLM. Deterministic logic only.

---

## Task 1: Admin auth — second password, second session flag

**Files:**
- Modify: `lib/auth.ts`
- Modify: `app/api/login/route.ts`
- Modify: `tests/auth.test.ts`

**Interfaces:**
- Produces: `ADMIN_SESSION_COOKIE: string`, `checkAdminPassword(input: string): boolean`, `isAdmin(cookieValue: string | undefined): boolean`, `isAdminRequest(req: Request): boolean`.

- [ ] **Step 1: Write the failing tests**

Replace `tests/auth.test.ts` with:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { checkPassword, isAuthed, checkAdminPassword, isAdmin, isAdminRequest, SESSION_COOKIE, ADMIN_SESSION_COOKIE } from "@/lib/auth";

beforeEach(() => {
  process.env.APP_PASSWORD = "secret123";
  process.env.APP_ADMIN_PASSWORD = "adminsecret456";
  process.env.APP_SESSION_TOKEN = "token-abc";
});

describe("auth", () => {
  it("exposes the cookie names", () => {
    expect(SESSION_COOKIE).toBe("sms_session");
    expect(ADMIN_SESSION_COOKIE).toBe("sms_admin");
  });
  it("checks the shared password", () => {
    expect(checkPassword("secret123")).toBe(true);
    expect(checkPassword("nope")).toBe(false);
    expect(checkPassword("")).toBe(false);
  });
  it("validates the session cookie against the token", () => {
    expect(isAuthed("token-abc")).toBe(true);
    expect(isAuthed("wrong")).toBe(false);
    expect(isAuthed(undefined)).toBe(false);
  });
  it("checks the admin password, independent of the regular one", () => {
    expect(checkAdminPassword("adminsecret456")).toBe(true);
    expect(checkAdminPassword("secret123")).toBe(false);
    expect(checkAdminPassword("")).toBe(false);
  });
  it("validates the admin cookie against the same session token", () => {
    expect(isAdmin("token-abc")).toBe(true);
    expect(isAdmin("wrong")).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
  it("extracts the admin cookie from a raw Request", () => {
    const withCookie = new Request("http://localhost/x", { headers: { Cookie: `${ADMIN_SESSION_COOKIE}=token-abc` } });
    expect(isAdminRequest(withCookie)).toBe(true);
    const wrongValue = new Request("http://localhost/x", { headers: { Cookie: `${ADMIN_SESSION_COOKIE}=nope` } });
    expect(isAdminRequest(wrongValue)).toBe(false);
    const noCookie = new Request("http://localhost/x");
    expect(isAdminRequest(noCookie)).toBe(false);
    const otherCookie = new Request("http://localhost/x", { headers: { Cookie: `${SESSION_COOKIE}=token-abc` } });
    expect(isAdminRequest(otherCookie)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm run test -- tests/auth.test.ts`
Expected: FAIL — `checkAdminPassword`, `isAdmin`, `isAdminRequest`, `ADMIN_SESSION_COOKIE` not exported.

- [ ] **Step 3: Implement in `lib/auth.ts`**

Replace the full file with:

```typescript
export const SESSION_COOKIE = "sms_session";
export const ADMIN_SESSION_COOKIE = "sms_admin";

export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD ?? "";
  return expected.length > 0 && input === expected;
}

export function checkAdminPassword(input: string): boolean {
  const expected = process.env.APP_ADMIN_PASSWORD ?? "";
  return expected.length > 0 && input === expected;
}

export function sessionToken(): string {
  return process.env.APP_SESSION_TOKEN ?? "";
}

export function isAuthed(cookieValue: string | undefined): boolean {
  const token = sessionToken();
  return token.length > 0 && cookieValue === token;
}

// Admin sessions are flagged by a second cookie carrying the same secret
// session token — set only when login used APP_ADMIN_PASSWORD. Reusing the
// token (rather than minting a second secret) keeps this a one-env-var change.
export function isAdmin(cookieValue: string | undefined): boolean {
  const token = sessionToken();
  return token.length > 0 && cookieValue === token;
}

function parseCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

// Route handlers receive a plain Request, not a NextRequest, and next/headers'
// cookies() requires Next's request-scoped context (absent when a test calls
// a route's exported handler directly) — so admin checks in routes parse the
// raw Cookie header instead.
export function isAdminRequest(req: Request): boolean {
  return isAdmin(parseCookie(req, ADMIN_SESSION_COOKIE));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/auth.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire the admin cookie into login**

Replace `app/api/login/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { checkPassword, checkAdminPassword, sessionToken, SESSION_COOKIE, ADMIN_SESSION_COOKIE } from "@/lib/auth";
import { requestBaseUrl } from "@/lib/http";

export async function POST(req: Request) {
  const base = requestBaseUrl(req);
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const isAdminLogin = checkAdminPassword(password);
  if (!checkPassword(password) && !isAdminLogin) {
    return NextResponse.redirect(new URL("/login?error=1", base), { status: 303 });
  }
  const res = NextResponse.redirect(new URL("/", base), { status: 303 });
  res.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  if (isAdminLogin) {
    res.cookies.set(ADMIN_SESSION_COOKIE, sessionToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return res;
}
```

- [ ] **Step 6: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/auth.ts app/api/login/route.ts tests/auth.test.ts
git commit -m "feat(auth): add a second admin password and session flag"
```

---

## Task 2: Migration — `Project.onboardingCompletedAt`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260621120000_add_onboarding_completed_at/migration.sql`

**Interfaces:**
- Produces: `Project.onboardingCompletedAt: Date | null` on the Prisma client.

- [ ] **Step 1: Add the column to the schema**

In `prisma/schema.prisma`, in `model Project`, add one field (anywhere among the scalar fields, e.g. right after `status`):

```prisma
  onboardingCompletedAt DateTime?
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260621120000_add_onboarding_completed_at/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "Project" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

-- Backfill: existing projects are treated as already onboarded so they are
-- not retroactively forced through the first-time setup wizard added in
-- Slice 5e.
UPDATE "Project" SET "onboardingCompletedAt" = CURRENT_TIMESTAMP WHERE "onboardingCompletedAt" IS NULL;
```

- [ ] **Step 3: Apply the migration (requires `DATABASE_URL`)**

Run: `npx prisma migrate deploy`
Expected: `1 migration found` / `applied`.

Run: `npx prisma generate`
Expected: Prisma client regenerated with the new field.

- [ ] **Step 4: Verify the backfill**

Run:
```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const stale = await prisma.project.count({ where: { onboardingCompletedAt: null } });
  console.log('Projects still null:', stale);
  await prisma.\$disconnect();
})();
"
```
Expected: `Projects still null: 0`.

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: succeeds (Prisma client types include the new field).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260621120000_add_onboarding_completed_at
git commit -m "feat(onboarding): add Project.onboardingCompletedAt with backfill"
```

---

## Task 3: Schedule health — Progress summary (pure function + service wiring)

**Files:**
- Modify: `lib/health/dateChecks.ts`
- Modify: `lib/health/healthService.ts`
- Modify: `tests/health/dateChecks.test.ts`
- Modify: `tests/health/healthService.test.ts`

**Interfaces:**
- Consumes: `HealthActivity`, `isLeafActive` (already in `dateChecks.ts`).
- Produces: `ProgressSummary { total: number; completed: number; remaining: number; percentComplete: number }`, `summarizeProgress(activities: HealthActivity[]): ProgressSummary`. `ScheduleHealth` gains `progress: ProgressSummary`.

- [ ] **Step 1: Write the failing pure-function test**

Append to `tests/health/dateChecks.test.ts` (same file already imports `act` and other check functions — add to the import list and add a new `describe` block at the end):

```typescript
// add summarizeProgress to the existing import from "@/lib/health/dateChecks"

describe("summarizeProgress", () => {
  it("counts completed vs remaining leaf-active activities", () => {
    const activities: HealthActivity[] = [
      act({ id: "a", percentComplete: 100 }),
      act({ id: "b", percentComplete: 100 }),
      act({ id: "c", percentComplete: 50 }),
      act({ id: "d", percentComplete: null }),
      act({ id: "summary", type: "summary", percentComplete: 100 }), // excluded: not a leaf
      act({ id: "inactive", isActive: false, percentComplete: 100 }), // excluded: inactive
    ];
    expect(summarizeProgress(activities)).toEqual({ total: 4, completed: 2, remaining: 2, percentComplete: 50 });
  });

  it("returns zeros for an empty schedule", () => {
    expect(summarizeProgress([])).toEqual({ total: 0, completed: 0, remaining: 0, percentComplete: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/health/dateChecks.test.ts`
Expected: FAIL — `summarizeProgress` is not exported.

- [ ] **Step 3: Implement in `lib/health/dateChecks.ts`**

Add near `summarizeHealth` (end of file):

```typescript
export interface ProgressSummary {
  total: number;
  completed: number;
  remaining: number;
  percentComplete: number;
}

export function summarizeProgress(activities: HealthActivity[]): ProgressSummary {
  const leaves = activities.filter(isLeafActive);
  const total = leaves.length;
  const completed = leaves.filter((a) => a.percentComplete === 100).length;
  const remaining = total - completed;
  const percentComplete = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { total, completed, remaining, percentComplete };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/health/dateChecks.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `healthService.ts`**

In `lib/health/healthService.ts`, update the import line and both return statements:

```typescript
import {
  runHealthChecks,
  summarizeHealth,
  summarizeProgress,
  computeEnvelope,
  isLeafActive,
  type HealthActivity,
  type HealthIssue,
  type HealthSummary,
  type DateWindow,
  type ProgressSummary,
} from "@/lib/health/dateChecks";

export interface ScheduleHealth {
  hasImport: boolean;
  asOfDate: Date | null;
  window: DateWindow | null;
  issues: HealthIssue[];
  summary: HealthSummary;
  progress: ProgressSummary;
}
```

Update the early-return (no import) line:

```typescript
  if (!latest) {
    return { hasImport: false, asOfDate: null, window: null, issues: [], summary: summarizeHealth([]), progress: summarizeProgress([]) };
  }
```

Update the final return line:

```typescript
  return { hasImport: true, asOfDate, window, issues, summary: summarizeHealth(issues), progress: summarizeProgress(activities) };
```

- [ ] **Step 6: Extend the DB-gated service test**

In `tests/health/healthService.test.ts`, after the existing `expect(health.summary.warnings).toBe(0);` line in the first test, add:

```typescript
    // 5 leaf activities total (uid 1,2,3,9,10); only uid 10 is 100% complete.
    expect(health.progress).toEqual({ total: 5, completed: 1, remaining: 4, percentComplete: 20 });
```

And in the "reports no import" test, after `expect(health.issues).toEqual([]);` add:

```typescript
    expect(health.progress).toEqual({ total: 0, completed: 0, remaining: 0, percentComplete: 0 });
```

- [ ] **Step 7: Run the DB-gated test (requires `DATABASE_URL`)**

Run: `npm run test -- tests/health/healthService.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/health/dateChecks.ts lib/health/healthService.ts tests/health/dateChecks.test.ts tests/health/healthService.test.ts
git commit -m "feat(health): add a Progress summary (total/completed/remaining/%)"
```

---

## Task 4: Schedule health — sectioned page redesign

**Files:**
- Create: `components/HealthCheckSection.tsx`
- Modify: `app/projects/[id]/health/page.tsx`
- Delete: `components/HealthIssuesTable.tsx` (superseded — no other consumer; verify with the grep in Step 1)

**Interfaces:**
- Consumes: `HealthIssue`, `HealthCheck` from `lib/health/dateChecks.ts`; `ScheduleHealth` from `lib/health/healthService.ts` (Task 3).
- Produces: `HealthCheckSection({ title, issues }: { title: string; issues: HealthIssue[] })`.

- [ ] **Step 1: Confirm `HealthIssuesTable` has no other consumer**

Run: `grep -rn "HealthIssuesTable" /home/coder/projects/Skilesconnect/schedulemanagement/app /home/coder/projects/Skilesconnect/schedulemanagement/components`
Expected: only `components/HealthIssuesTable.tsx` itself and `app/projects/[id]/health/page.tsx`.

- [ ] **Step 2: Create `components/HealthCheckSection.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import type { HealthIssue } from "@/lib/health/dateChecks";

export function HealthCheckSection({ title, issues }: { title: string; issues: HealthIssue[] }) {
  const [q, setQ] = useState("");

  const view = useMemo(() => {
    if (!q.trim()) return issues;
    const needle = q.trim().toLowerCase();
    return issues.filter(
      (i) => i.name.toLowerCase().includes(needle) || (i.wbsCode ?? "").includes(needle) || String(i.externalId ?? "").includes(needle),
    );
  }, [issues, q]);

  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${issues.length === 0 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
          {issues.length === 0 ? "Clean" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {issues.length > 0 && (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name / WBS / ID"
            className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
            {view.map((i, idx) => (
              <li key={`${i.activityId}-${idx}`} className="px-3 py-2">
                <span className="mr-2 text-xs text-slate-400">{i.wbsCode}</span>
                <span className="font-medium">{i.name}</span>
                <div className="mt-1 text-xs text-slate-600">{i.message}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Rewrite `app/projects/[id]/health/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getScheduleHealth } from "@/lib/health/healthService";
import { HealthCheckSection } from "@/components/HealthCheckSection";
import type { HealthCheck } from "@/lib/health/dateChecks";

export const dynamic = "force-dynamic";

const SECTIONS: { check: HealthCheck; title: string }[] = [
  { check: "out_of_envelope", title: "Out-of-envelope dates" },
  { check: "future_actual", title: "Future actuals" },
  { check: "missing_dates", title: "Missing dates" },
  { check: "percent_contradiction", title: "Percent contradictions" },
];

export default async function HealthPage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const health = await getScheduleHealth(project.id);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Schedule health</h1>
      {!health.hasImport ? (
        <p className="text-slate-500">Import a schedule first.</p>
      ) : (
        <>
          {health.asOfDate && <p className="mb-4 text-sm text-slate-500">Data date {health.asOfDate.toISOString().slice(0, 10)}</p>}
          <section className="mb-6 rounded border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Progress</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              <div><span className="font-medium">{health.progress.total}</span> total</div>
              <div><span className="font-medium">{health.progress.completed}</span> completed</div>
              <div><span className="font-medium">{health.progress.remaining}</span> remaining</div>
              <div><span className="font-medium">{health.progress.percentComplete}%</span> complete</div>
            </div>
          </section>
          {SECTIONS.map(({ check, title }) => (
            <HealthCheckSection key={check} title={title} issues={health.issues.filter((i) => i.check === check)} />
          ))}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Delete the superseded component**

Run: `rm components/HealthIssuesTable.tsx`

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: succeeds, no unresolved import errors.

- [ ] **Step 6: Run full test suite**

Run: `npm run test`
Expected: PASS (no test referenced `HealthIssuesTable`).

- [ ] **Step 7: Manual smoke**

Visit `/projects/<id>/health` for a project with a mixed-health import. Confirm: Progress numbers render; each of the 4 sections shows "Clean" or its own issue list; search within a section filters only that section.

- [ ] **Step 8: Commit**

```bash
git add components/HealthCheckSection.tsx app/projects/\[id\]/health/page.tsx
git rm components/HealthIssuesTable.tsx
git commit -m "feat(health): sectioned page with a Progress summary and per-check headers"
```

---

## Task 5: Export — inject canonical names into the XML

**Files:**
- Modify: `lib/export/injectActuals.ts`
- Modify: `lib/export/buildExport.ts`
- Modify: `tests/export/injectActuals.test.ts`
- Modify: `tests/export/buildExport.test.ts`

**Interfaces:**
- Consumes: `applyDictionary` from `lib/normalize/normalizationService.ts` (existing).
- Produces: `injectNames(doc: AnyRec, nameByUid: Map<number, string>): AnyRec`.

- [ ] **Step 1: Write the failing unit test**

Append to `tests/export/injectActuals.test.ts` (it already has `doc()` and `tasks()` helpers — add `injectNames` to the import and add a new `describe` block at the end):

```typescript
import { injectActuals, injectNames, type ProgressForExport } from "@/lib/export/injectActuals";

// ...(existing content unchanged)...

describe("injectNames", () => {
  it("overwrites the Name of matched tasks only", () => {
    const d = doc();
    injectNames(d, new Map([[1, "Mobilization"]]));
    expect(tasks(d)[0].Name).toBe("Mobilization");
    expect(tasks(d)[1].Name).toBe("B");
    expect(tasks(d)[2].Name).toBe("C");
  });
  it("handles a single (non-array) Task node", () => {
    const d = { Project: { Tasks: { Task: { UID: "1", Name: "A" } } } } as Record<string, unknown>;
    injectNames(d, new Map([[1, "Renamed"]]));
    expect(((d.Project as any).Tasks.Task).Name).toBe("Renamed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/export/injectActuals.test.ts`
Expected: FAIL — `injectNames` is not exported.

- [ ] **Step 3: Implement `injectNames` in `lib/export/injectActuals.ts`**

Add at the end of the file (reuses the file's existing private `asArray` helper):

```typescript
/** Mutate matching <Task> nodes' Name with the canonical scope from the map; leaves everything else untouched. */
export function injectNames(doc: AnyRec, nameByUid: Map<number, string>): AnyRec {
  const project = doc.Project as AnyRec | undefined;
  const tasksNode = project?.Tasks as AnyRec | undefined;
  for (const task of asArray(tasksNode?.Task)) {
    const name = nameByUid.get(Number(task.UID));
    if (name) task.Name = name;
  }
  return doc;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/export/injectActuals.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `buildExport.ts`**

In `lib/export/buildExport.ts`, update the import and add name injection right after the existing actuals injection:

```typescript
import { injectActuals, injectNames, type ProgressForExport } from "@/lib/export/injectActuals";
import { applyDictionary } from "@/lib/normalize/normalizationService";
```

Inside `buildExport`, after the existing `progressByUid` loop and before `const doc = parseForExport(uploadedXml);`, add:

```typescript
  const { mapped } = await applyDictionary(latest.activities);
  const nameByUid = new Map<number, string>();
  for (const { activity, canonicalScope } of mapped) {
    nameByUid.set(activity.externalUid, canonicalScope);
  }
```

Then change the injection lines from:

```typescript
  const doc = parseForExport(uploadedXml);
  injectActuals(doc, progressByUid);
```

to:

```typescript
  const doc = parseForExport(uploadedXml);
  injectActuals(doc, progressByUid);
  injectNames(doc, nameByUid);
```

- [ ] **Step 6: Extend the DB-gated `buildExport` test**

In `tests/export/buildExport.test.ts`, in the first test (`"injects cumulative progress and rejects bad inputs"`), after `await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });` and before the `// no finalized progress yet` line, add a dictionary mapping for the fixture's UID-2 activity ("Electrical Rough-In"):

```typescript
    await prisma.scopeDictionaryEntry.upsert({
      where: { normalizedName: "electrical rough-in" },
      create: { normalizedName: "electrical rough-in", canonicalScope: "Electrical Rough-In (Standard)" },
      update: { canonicalScope: "Electrical Rough-In (Standard)" },
    });
```

After the existing `expect((doc.Project as any).StatusDate).toBe(...)` assertion, add:

```typescript
    expect(findTask(doc, "2").Name).toBe("Electrical Rough-In (Standard)");
    expect(findTask(doc, "1").Name).toBe("Mobilize"); // unmapped — untouched
```

At the end of the test (before the closing of the `it` block), clean up the dictionary row so it doesn't leak into other tests:

```typescript
    await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: "electrical rough-in" } });
```

- [ ] **Step 7: Run the DB-gated test**

Run: `npm run test -- tests/export/buildExport.test.ts`
Expected: PASS.

- [ ] **Step 8: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 9: Commit**

```bash
git add lib/export/injectActuals.ts lib/export/buildExport.ts tests/export/injectActuals.test.ts tests/export/buildExport.test.ts
git commit -m "feat(export): push normalized canonical names into the exported XML"
```

---

## Task 6: Gate split-rule add/remove behind the admin session

**Files:**
- Modify: `app/api/completeness/split-rules/route.ts`
- Modify: `tests/completeness/splitRuleService.test.ts`

**Interfaces:**
- Consumes: `isAdminRequest` from `lib/auth.ts` (Task 1).

- [ ] **Step 1: Update the route**

```typescript
import { NextResponse } from "next/server";
import { addSplitRule, removeSplitRule } from "@/lib/completeness/splitRuleService";
import { isAdminRequest } from "@/lib/auth";

interface SplitRuleBody {
  coarseScope?: string;
  finerScope?: string;
}

function validate(body: SplitRuleBody): string | null {
  if (!body.coarseScope?.trim() || !body.finerScope?.trim()) return "coarseScope and finerScope are required.";
  return null;
}

export async function POST(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: { message: "Admin access required." } }, { status: 403 });
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
  if (!isAdminRequest(req)) return NextResponse.json({ error: { message: "Admin access required." } }, { status: 403 });
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

- [ ] **Step 2: Update the existing route tests to authenticate as admin, and add a 403 test**

In `tests/completeness/splitRuleService.test.ts`, add the admin cookie to every request the existing tests build, and add one new rejection test. Replace the `"route adds and removes a rule"` and `"route rejects a missing coarseScope"` tests, and add a new test, so the relevant block reads:

```typescript
  it("route adds and removes a rule", async () => {
    const { POST, DELETE } = await import("@/app/api/completeness/split-rules/route");
    const body = JSON.stringify({ coarseScope: coarse, finerScope: "Route Finer" });
    const adminHeaders = { "Content-Type": "application/json", Cookie: "sms_admin=token-abc" };

    const postRes = await POST(new Request("http://localhost/api/completeness/split-rules", {
      method: "POST", headers: adminHeaders, body,
    }));
    expect(postRes.status).toBe(200);
    expect((await getSplitRules()).get(coarse)).toContain("Route Finer");

    const delRes = await DELETE(new Request("http://localhost/api/completeness/split-rules", {
      method: "DELETE", headers: adminHeaders, body,
    }));
    expect(delRes.status).toBe(200);
    expect((await getSplitRules()).get(coarse) ?? []).not.toContain("Route Finer");
  }, 30000);

  it("route rejects a missing coarseScope", async () => {
    const { POST } = await import("@/app/api/completeness/split-rules/route");
    const res = await POST(new Request("http://localhost/api/completeness/split-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: "sms_admin=token-abc" },
      body: JSON.stringify({ finerScope: "x" }),
    }));
    expect(res.status).toBe(422);
  });

  it("route rejects a non-admin session", async () => {
    const { POST } = await import("@/app/api/completeness/split-rules/route");
    const res = await POST(new Request("http://localhost/api/completeness/split-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coarseScope: coarse, finerScope: "Route Finer" }),
    }));
    expect(res.status).toBe(403);
    expect((await getSplitRules()).get(coarse) ?? []).not.toContain("Route Finer");
  });
```

This test file needs `process.env.APP_SESSION_TOKEN` set to `"token-abc"` for the cookie to validate — add at the top of the `describe.runIf(hasDb)` block, right after the `const coarse = ...` line:

```typescript
  process.env.APP_SESSION_TOKEN = process.env.APP_SESSION_TOKEN || "token-abc";
```

- [ ] **Step 3: Run the DB-gated test**

Run: `npm run test -- tests/completeness/splitRuleService.test.ts`
Expected: PASS (including the new 403 test).

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/api/completeness/split-rules/route.ts tests/completeness/splitRuleService.test.ts
git commit -m "feat(completeness): require an admin session to add or remove split rules"
```

---

## Task 7: Normalize page — rename, inline split authoring, admin-gated panels

**Files:**
- Modify: `components/NormalizePanel.tsx`
- Modify: `components/SplitRulesPanel.tsx`
- Modify: `app/projects/[id]/normalize/page.tsx`

**Interfaces:**
- Consumes: `isAdmin`, `ADMIN_SESSION_COOKIE` from `lib/auth.ts` (Task 1); existing `/api/normalize` and `/api/completeness/split-rules` routes.

No automated test for this task — matches the existing convention that client panel components in this codebase (`NormalizePanel`, `SplitRulesPanel`, `CompletenessIssuesTable`) have no dedicated unit tests; correctness is covered by `npm run build` plus the manual smoke test below.

- [ ] **Step 1: Add the inline split control to `NormalizePanel`**

Replace `components/NormalizePanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface UnmappedRow {
  rawName: string;
  count: number;
  suggestions: string[];
}

export function NormalizePanel({
  projectId,
  rows,
  knownScopes,
  isAdmin,
}: {
  projectId: string;
  rows: UnmappedRow[];
  knownScopes: string[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [splits, setSplits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(rawName: string, scope: string) {
    setValues((v) => ({ ...v, [rawName]: scope }));
  }

  function setSplit(rawName: string, finerScopes: string) {
    setSplits((s) => ({ ...s, [rawName]: finerScopes }));
  }

  function useAsIs(rawName: string) {
    set(rawName, rawName);
  }

  function acceptAllAsIs() {
    setValues((v) => {
      const next = { ...v };
      for (const r of rows) if (!next[r.rawName]?.trim()) next[r.rawName] = r.rawName;
      return next;
    });
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
    if (!res.ok) {
      setBusy(false);
      setError((await res.json())?.error?.message ?? "Save failed.");
      return;
    }
    for (const [rawName, finerRaw] of Object.entries(splits)) {
      const coarseScope = values[rawName]?.trim();
      if (!coarseScope || !finerRaw.trim()) continue;
      for (const finerScope of finerRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
        await fetch("/api/completeness/split-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coarseScope, finerScope }),
        });
      }
    }
    setBusy(false);
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
            <div className="mt-1 flex flex-wrap gap-1">
              <button onClick={() => useAsIs(r.rawName)} className="rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100">Use as-is</button>
              {r.suggestions.map((s) => (
                <button key={s} onClick={() => set(r.rawName, s)} className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">{s}</button>
              ))}
            </div>
            <input
              list="known-scopes"
              value={values[r.rawName] ?? ""}
              onChange={(e) => set(r.rawName, e.target.value)}
              placeholder="Standard scope"
              className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
            {isAdmin && (
              <input
                value={splits[r.rawName] ?? ""}
                onChange={(e) => setSplit(r.rawName, e.target.value)}
                placeholder="Coarse? List finer scopes, comma-separated (e.g. Drywall Hang, Drywall Tape)"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-600"
              />
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={busy} onClick={acceptAllAsIs} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
          Accept all shown as-is
        </button>
        <button disabled={busy} onClick={save} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save mappings"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Gate `SplitRulesPanel` to read-only for non-admins, drop the add form**

Replace `components/SplitRulesPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SplitRuleRow {
  coarseScope: string;
  finerScopes: string[];
}

export function SplitRulesPanel({ rules, isAdmin }: { rules: SplitRuleRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(coarseScope: string, finerScope: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/completeness/split-rules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coarseScope, finerScope }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Remove failed.");
      return;
    }
    router.refresh();
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Split rules</h2>
      <p className="mb-2 text-xs text-slate-500">
        Scopes marked coarse and the finer scopes they should really be tracked as. Add new rules inline above when mapping an activity name.
      </p>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {rules.length === 0 ? (
        <p className="text-sm text-slate-500">No split rules defined yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {rules.map((r) => (
            <li key={r.coarseScope} className="px-3 py-3">
              <div className="font-medium">{r.coarseScope}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.finerScopes.map((f) =>
                  isAdmin ? (
                    <button key={f} disabled={busy} onClick={() => remove(r.coarseScope, f)} className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200" title="Remove">
                      {f} ×
                    </button>
                  ) : (
                    <span key={f} className="rounded bg-slate-100 px-2 py-1 text-xs">{f}</span>
                  ),
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Rename and wire admin status into the page**

Replace `app/projects/[id]/normalize/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { applyDictionary, getKnownScopes } from "@/lib/normalize/normalizationService";
import { suggestScopes } from "@/lib/normalize/suggestScopes";
import { getSplitRules } from "@/lib/completeness/splitRuleService";
import { isAdmin, ADMIN_SESSION_COOKIE } from "@/lib/auth";
import { NormalizePanel, type UnmappedRow } from "@/components/NormalizePanel";
import { SplitRulesPanel, type SplitRuleRow } from "@/components/SplitRulesPanel";

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
  const splitRulesMap = await getSplitRules();
  const splitRules: SplitRuleRow[] = [...splitRulesMap.entries()].map(([coarseScope, finerScopes]) => ({ coarseScope, finerScopes }));
  const adminSession = isAdmin(cookies().get(ADMIN_SESSION_COOKIE)?.value);

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
      <h1 className="mb-1 mt-1 text-xl font-semibold">Normalize activity names</h1>
      <p className="mb-4 text-sm text-slate-500">{mapped.length} activities already mapped · {rows.length} names to review</p>
      {!latest ? (
        <p className="text-slate-500">Import a schedule first.</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-500">All activity names are mapped.</p>
      ) : (
        <NormalizePanel projectId={project.id} rows={rows} knownScopes={knownScopes} isAdmin={adminSession} />
      )}
      <div className="mt-8">
        <SplitRulesPanel rules={splitRules} isAdmin={adminSession} />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Run full test suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 6: Manual smoke**

Log in with the regular password → visit Normalize → confirm no inline split input shows, and the Split Rules panel's chips are plain (no `×`). Log in with the admin password → both controls appear; map a new raw name, type one finer scope, save → Completeness page flags an activity mapped to that scope (if one exists) and the Split Rules panel lists the new rule.

- [ ] **Step 7: Commit**

```bash
git add components/NormalizePanel.tsx components/SplitRulesPanel.tsx app/projects/\[id\]/normalize/page.tsx
git commit -m "feat(normalize): rename to 'Normalize activity names', move split authoring inline, gate to admin"
```

---

## Task 8: Wizard banner, nav reorder, and rename in project page

**Files:**
- Create: `components/WizardBanner.tsx`
- Modify: `app/projects/[id]/health/page.tsx`
- Modify: `app/projects/[id]/normalize/page.tsx`
- Modify: `app/projects/[id]/completeness/page.tsx`
- Modify: `app/projects/[id]/page.tsx`

**Interfaces:**
- Produces: `WizardBanner({ projectId, step, why }: { projectId: string; step: 0 | 1 | 2; why: string })`.

- [ ] **Step 1: Create `components/WizardBanner.tsx`**

```tsx
import Link from "next/link";

const STEPS = [
  { path: "health", label: "Schedule health" },
  { path: "normalize", label: "Normalize activity names" },
  { path: "completeness", label: "Completeness" },
] as const;

export function WizardBanner({ projectId, step, why }: { projectId: string; step: 0 | 1 | 2; why: string }) {
  const prevPath = step > 0 ? STEPS[step - 1].path : null;
  const nextPath = step < STEPS.length - 1 ? STEPS[step + 1].path : null;

  return (
    <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm">
      <div className="mb-1 font-medium text-blue-900">
        First-time setup — step {step + 1} of {STEPS.length}: {STEPS[step].label}
      </div>
      <p className="mb-2 text-blue-800">{why}</p>
      <div className="flex gap-2">
        {prevPath && (
          <Link href={`/projects/${projectId}/${prevPath}?wizard=1`} className="rounded border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-900">
            Back
          </Link>
        )}
        {nextPath ? (
          <Link href={`/projects/${projectId}/${nextPath}?wizard=1`} className="rounded bg-blue-900 px-3 py-1.5 text-xs font-medium text-white">
            Next
          </Link>
        ) : (
          <form action={`/api/projects/${projectId}/complete-onboarding`} method="POST">
            <button type="submit" className="rounded bg-blue-900 px-3 py-1.5 text-xs font-medium text-white">
              Finish setup
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the banner to the Health page**

In `app/projects/[id]/health/page.tsx`, add `searchParams` to the page's props and render the banner. Change the function signature and the JSX:

```tsx
export default async function HealthPage({ params, searchParams }: { params: { id: string }; searchParams: { wizard?: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const health = await getScheduleHealth(project.id);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Schedule health</h1>
      {searchParams.wizard === "1" && (
        <WizardBanner
          projectId={project.id}
          step={0}
          why="Catch bad or implausible dates before anything else, since a bad date can throw off everything downstream."
        />
      )}
      {!health.hasImport ? (
```

(the rest of the JSX is unchanged from Task 4). Add the import:

```tsx
import { WizardBanner } from "@/components/WizardBanner";
```

- [ ] **Step 3: Add the banner to the Normalize page**

In `app/projects/[id]/normalize/page.tsx`, add `searchParams` to the props and the import, and insert the banner right after the `<h1>`:

```tsx
import { WizardBanner } from "@/components/WizardBanner";

export default async function NormalizePage({ params, searchParams }: { params: { id: string }; searchParams: { wizard?: string } }) {
```

```tsx
      <h1 className="mb-1 mt-1 text-xl font-semibold">Normalize activity names</h1>
      {searchParams.wizard === "1" && (
        <WizardBanner
          projectId={project.id}
          step={1}
          why="Give every activity a consistent standard name so reporting and rollups work, and flag any scope that's too coarse to track meaningfully."
        />
      )}
      <p className="mb-4 text-sm text-slate-500">{mapped.length} activities already mapped · {rows.length} names to review</p>
```

- [ ] **Step 4: Add the banner to the Completeness page**

In `app/projects/[id]/completeness/page.tsx`:

```tsx
import { WizardBanner } from "@/components/WizardBanner";

export default async function CompletenessPage({ params, searchParams }: { params: { id: string }; searchParams: { wizard?: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const completeness = await getCompleteness(project.id);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Completeness</h1>
      {searchParams.wizard === "1" && (
        <WizardBanner
          projectId={project.id}
          step={2}
          why="Review the coarse-scope issues you just flagged and decide what to do — split it in MS Project and re-import, or dismiss it."
        />
      )}
      {!completeness.hasImport ? (
```

- [ ] **Step 5: Reorder and rename nav links on the project page**

In `app/projects/[id]/page.tsx`, replace the nav `<div className="flex gap-2">...</div>` block with (preserves the primary "Import schedule" button's styling and trailing position; reorders the rest to match the pipeline):

```tsx
        <div className="flex gap-2">
          <Link href={`/projects/${project.id}/health`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Schedule health
          </Link>
          <Link href={`/projects/${project.id}/normalize`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Normalize activity names
          </Link>
          <Link href={`/projects/${project.id}/completeness`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Completeness
          </Link>
          <Link href={`/projects/${project.id}/trades`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Trades
          </Link>
          <Link href={`/projects/${project.id}/updates`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Weekly updates
          </Link>
          <Link href={`/projects/${project.id}/export`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Export to MS Project
          </Link>
          <Link href={`/projects/${project.id}/import`} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            Import schedule
          </Link>
        </div>
```

- [ ] **Step 6: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Run full test suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 8: Manual smoke**

Visit `/projects/<id>/health?wizard=1` → banner shows step 1 of 3 with the Health "why," Next goes to `/projects/<id>/normalize?wizard=1` (step 2), Next again to `/projects/<id>/completeness?wizard=1` (step 3, shows "Finish setup" instead of Next), Back navigates correctly at each step. Visit the project page directly → nav links appear in the new order with "Normalize activity names" and "Schedule health" labels.

- [ ] **Step 9: Commit**

```bash
git add components/WizardBanner.tsx app/projects/\[id\]/health/page.tsx app/projects/\[id\]/normalize/page.tsx app/projects/\[id\]/completeness/page.tsx app/projects/\[id\]/page.tsx
git commit -m "feat(onboarding): add the wizard banner to Health/Normalize/Completeness, reorder project nav"
```

---

## Task 9: First-import trigger and Finish-setup route

**Files:**
- Create: `app/api/projects/[id]/complete-onboarding/route.ts`
- Modify: `app/api/imports/commit/route.ts`
- Modify: `components/ImportWizard.tsx`
- Create: `tests/onboarding/onboarding.test.ts`

**Interfaces:**
- Produces: `POST /api/projects/[id]/complete-onboarding` → redirects to `/projects/[id]`. `/api/imports/commit` response gains `startWizard: boolean`.

- [ ] **Step 1: Write the failing tests**

Create `tests/onboarding/onboarding.test.ts`:

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");
const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("onboarding", () => {
  let projectId = "";
  let projectId2 = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    if (projectId2) await prisma.project.delete({ where: { id: projectId2 } });
    await prisma.$disconnect();
  });

  it("flags startWizard true on a brand-new project's first import", async () => {
    const project = await prisma.project.create({ data: { name: "Onboarding Test", onboardingCompletedAt: null } });
    projectId = project.id;

    const { POST } = await import("@/app/api/imports/commit/route");
    const fd = new FormData();
    fd.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
    fd.append("projectId", project.id);
    const res = await POST(new Request("http://localhost/api/imports/commit", { method: "POST", body: fd }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.startWizard).toBe(true);
  }, 30000);

  it("flags startWizard false once onboarding is already complete", async () => {
    const project = await prisma.project.create({ data: { name: "Onboarding Test 2", onboardingCompletedAt: new Date() } });
    projectId2 = project.id;

    const { POST } = await import("@/app/api/imports/commit/route");
    const fd = new FormData();
    fd.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
    fd.append("projectId", project.id);
    const res = await POST(new Request("http://localhost/api/imports/commit", { method: "POST", body: fd }));
    const data = await res.json();
    expect(data.startWizard).toBe(false);
  }, 30000);

  it("complete-onboarding route sets onboardingCompletedAt and redirects to the project page", async () => {
    const project = await prisma.project.create({ data: { name: "Onboarding Test 3", onboardingCompletedAt: null } });
    const { POST } = await import("@/app/api/projects/[id]/complete-onboarding/route");
    const res = await POST(new Request(`http://localhost/api/projects/${project.id}/complete-onboarding`, { method: "POST" }), { params: { id: project.id } });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain(`/projects/${project.id}`);
    const updated = await prisma.project.findUnique({ where: { id: project.id } });
    expect(updated?.onboardingCompletedAt).not.toBeNull();
    await prisma.project.delete({ where: { id: project.id } });
  }, 15000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/onboarding/onboarding.test.ts`
Expected: FAIL — `startWizard` undefined, `complete-onboarding` route doesn't exist.

- [ ] **Step 3: Update the commit route**

Replace `app/api/imports/commit/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { commitImport } from "@/lib/import/commitImport";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  const statusDate = String(form.get("statusDate") ?? "").trim() || null;
  if (!(file instanceof File) || !projectId) {
    return NextResponse.json({ error: { message: "file and projectId are required." } }, { status: 400 });
  }
  const xml = await file.text();
  try {
    const { id } = await commitImport({ projectId, fileName: file.name, xml, statusDateOverride: statusDate });
    const [importCount, project] = await Promise.all([
      prisma.scheduleImport.count({ where: { projectId } }),
      prisma.project.findUnique({ where: { id: projectId }, select: { onboardingCompletedAt: true } }),
    ]);
    const startWizard = importCount === 1 && !project?.onboardingCompletedAt;
    return NextResponse.json({ id, startWizard });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to import.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
```

- [ ] **Step 4: Create the complete-onboarding route**

Create `app/api/projects/[id]/complete-onboarding/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requestBaseUrl } from "@/lib/http";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await prisma.project.update({ where: { id: params.id }, data: { onboardingCompletedAt: new Date() } });
  const base = requestBaseUrl(req);
  return NextResponse.redirect(new URL(`/projects/${params.id}`, base), { status: 303 });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- tests/onboarding/onboarding.test.ts`
Expected: PASS.

- [ ] **Step 6: Redirect into the wizard from the client**

In `components/ImportWizard.tsx`, update the `commit` function's success path:

```typescript
  async function commit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("projectId", projectId);
    if (statusDate) fd.append("statusDate", `${statusDate}:00`);
    const res = await fetch("/api/imports/commit", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Import failed.");
      return;
    }
    const data: { startWizard?: boolean } = await res.json();
    router.push(data.startWizard ? `/projects/${projectId}/health?wizard=1` : `/projects/${projectId}`);
    router.refresh();
  }
```

- [ ] **Step 7: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 8: Run full test suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 9: Manual smoke**

Create a brand-new project, import a schedule for the first time → lands on `/projects/<id>/health?wizard=1`, not the project page. Click through Next/Next/Finish setup → lands on the normal project page. Import a *second* file into the same project (or a different project that already has `onboardingCompletedAt` set) → lands on the project page directly, no wizard.

- [ ] **Step 10: Commit**

```bash
git add app/api/imports/commit/route.ts app/api/projects/\[id\]/complete-onboarding/route.ts components/ImportWizard.tsx tests/onboarding/onboarding.test.ts
git commit -m "feat(onboarding): trigger the setup wizard on a project's first import"
```

---

## Task 10: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all tests pass (DB-gated suites run only if `DATABASE_URL` is set — run once with it set to cover everything).

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 3: End-to-end manual smoke, against the full pipeline**

1. New project → import a schedule with some bad dates and at least one unmapped activity name → lands in the wizard at Health (shows the new issues + Progress numbers) → Next → Normalize (map the unmapped name; as admin, also add a split rule inline) → Next → Completeness (the just-flagged activity appears; dismiss it) → Finish setup → lands on the project page with the reordered, renamed nav.
2. Export the project → confirm the exported XML's `<Name>` for the mapped activity is the canonical scope, and an unmapped activity keeps its original name.
3. Log out, log back in with the regular (non-admin) password → Normalize's inline split input and the Split Rules panel's remove buttons are gone; the route returns 403 if called directly.

- [ ] **Step 4: Update the handoff doc**

In `docs/SLICE5_HANDOFF.md`, add Slice 5e to the "Live in production" list (item 8, after 5c) summarizing: workflow nav reorder, first-time wizard, Health's Progress section, Normalize's inline split authoring + admin gating, and export name injection. Update the "Tests: N passing, M files" line to the new totals from Step 1's output.

- [ ] **Step 5: Commit**

```bash
git add docs/SLICE5_HANDOFF.md
git commit -m "docs: update handoff for Slice 5e (workflow integration)"
```
