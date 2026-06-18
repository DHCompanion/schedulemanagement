# Slice 3 — Export Back to MS Project XML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the scheduler re-upload the originally-imported MS Project XML and download an updated copy with the cumulative field actuals/% complete injected into the matching tasks.

**Architecture:** Stateless, computed on the fly (no schema change). Pure modules format MSPDI dates and inject actuals into a parsed XML document; a dedicated `fast-xml-parser` config round-trips the file faithfully; a thin server orchestrator hash-matches the upload to the latest import, builds a `UID → progress` map from the Slice 2 current-progress overlay, injects, sets `StatusDate`, and returns the file. A client panel uploads and triggers the download.

**Tech Stack:** Next.js 14 (App Router), TypeScript (strict), Prisma + PostgreSQL, `fast-xml-parser` (existing dep), Vitest.

## Global Constraints

- **No schema change.** Export persists nothing.
- **Approach A:** the scheduler re-uploads the original `.xml`; verify by SHA-256 `fileHash` against the project's **latest** `ScheduleImport`. Mismatch → reject.
- **Cumulative current state:** `resolveCurrentProgress(getFinalizedEntries(projectId))` — the exact Slice 2 functions.
- **Fields written:** `ActualStart`, `ActualFinish`, `PercentComplete` only, plus project `StatusDate`. **No notes.**
- **Status → fields:** `complete` → `PercentComplete=100`, `ActualFinish` = actual finish else the task's own `Finish`, `ActualStart` = actual start else the task's own `Start`; `in_progress` → `ActualStart` = actual start else the task's `Start`, `PercentComplete` = entry's % when set; `not_started` → untouched.
- **Dedicated export parser config:** `ignoreAttributes: false` (the importer's `parseMspXml` uses `ignoreAttributes: true`, which would drop `xmlns` — do NOT reuse it). MSPDI datetimes are naive-local `YYYY-MM-DDTHH:MM:SS`; stored dates are UTC wall-clock (Slice 1 `toDbDate` appended `Z`), so emit UTC components with no zone.
- **Record only.** No CPM recompute, no remaining-duration.
- **No new test infrastructure.** Pure logic → Vitest unit; DB logic → `describe.runIf(!!process.env.DATABASE_URL)`; UI → `npm run build`. DB-gated tests that do many Railway round-trips get a `30000`ms per-test timeout.
- **`@/` path alias** maps to repo root.
- Run `npm run build` and `npm run test` before review.

---

## File Structure

**Created:**
- `lib/export/mspdiDate.ts` — format a stored Date to an MSPDI naive-local string
- `lib/export/injectActuals.ts` — pure: mutate parsed `<Task>` nodes from a `UID → progress` map
- `lib/export/serializeMspdi.ts` — dedicated parse/build config for faithful round-trip
- `lib/export/buildExport.ts` — server orchestrator (hash-match → map → inject → serialize)
- `app/api/export/route.ts` — POST: file → updated `.xml` download or 422
- `app/projects/[id]/export/page.tsx` — context + panel
- `components/ExportPanel.tsx` — client upload + blob download
- `tests/export/mspdiDate.test.ts`, `tests/export/injectActuals.test.ts`, `tests/export/serializeMspdi.test.ts`, `tests/export/buildExport.test.ts`

**Modified:**
- `app/projects/[id]/page.tsx` — add "Export to MS Project" nav button

---

## Task 1: MSPDI date formatter

**Files:**
- Create: `lib/export/mspdiDate.ts`
- Test: `tests/export/mspdiDate.test.ts`

**Interfaces:**
- Produces: `toMspdiDate(d: Date): string` → `YYYY-MM-DDTHH:MM:SS` from the Date's UTC components.

- [ ] **Step 1: Write the failing test**

Create `tests/export/mspdiDate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toMspdiDate } from "@/lib/export/mspdiDate";

describe("toMspdiDate", () => {
  it("formats a stored UTC wall-clock date as a naive MSPDI string", () => {
    expect(toMspdiDate(new Date("2025-06-03T17:00:00Z"))).toBe("2025-06-03T17:00:00");
  });
  it("renders a date-only value at midnight", () => {
    expect(toMspdiDate(new Date("2026-06-15T00:00:00Z"))).toBe("2026-06-15T00:00:00");
  });
  it("zero-pads month, day, and time components", () => {
    expect(toMspdiDate(new Date("2026-01-05T08:09:07Z"))).toBe("2026-01-05T08:09:07");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/export/mspdiDate.test.ts`
Expected: FAIL — `Cannot find module '@/lib/export/mspdiDate'`.

- [ ] **Step 3: Implement**

Create `lib/export/mspdiDate.ts`:

```ts
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** MSPDI datetimes are naive-local; stored dates are UTC wall-clock, so emit UTC components with no zone. */
export function toMspdiDate(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/export/mspdiDate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/export/mspdiDate.ts tests/export/mspdiDate.test.ts
git commit -m "feat(export): MSPDI naive-local date formatter"
```

---

## Task 2: Inject actuals into parsed task nodes

**Files:**
- Create: `lib/export/injectActuals.ts`
- Test: `tests/export/injectActuals.test.ts`

**Interfaces:**
- Consumes: `toMspdiDate` from `@/lib/export/mspdiDate`.
- Produces:
  - type `ProgressForExport` = `{ status: string; actualStart: Date | null; actualFinish: Date | null; percentComplete: number | null }`
  - `injectActuals(doc: Record<string, unknown>, progressByUid: Map<number, ProgressForExport>): Record<string, unknown>` — mutates `doc.Project.Tasks.Task` nodes in place and returns `doc`.

- [ ] **Step 1: Write the failing test**

Create `tests/export/injectActuals.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { injectActuals, type ProgressForExport } from "@/lib/export/injectActuals";

function doc() {
  return {
    Project: {
      Tasks: {
        Task: [
          { UID: "1", Name: "A", Start: "2025-06-03T08:00:00", Finish: "2025-06-03T17:00:00", PercentComplete: "0" },
          { UID: "2", Name: "B", Start: "2025-06-04T08:00:00", Finish: "2025-06-06T17:00:00", PercentComplete: "0" },
          { UID: "3", Name: "C", Start: "2025-06-07T08:00:00", Finish: "2025-06-08T17:00:00", PercentComplete: "0" },
        ],
      },
    },
  } as Record<string, unknown>;
}
function tasks(d: Record<string, unknown>) {
  return ((d.Project as any).Tasks.Task) as any[];
}
const prog = (p: Partial<ProgressForExport>): ProgressForExport => ({
  status: "in_progress", actualStart: null, actualFinish: null, percentComplete: null, ...p,
});

describe("injectActuals", () => {
  it("writes actual start and % for in-progress", () => {
    const d = doc();
    injectActuals(d, new Map([[1, prog({ status: "in_progress", actualStart: new Date("2026-06-16T00:00:00Z"), percentComplete: 50 })]]));
    expect(tasks(d)[0].ActualStart).toBe("2026-06-16T00:00:00");
    expect(tasks(d)[0].PercentComplete).toBe("50");
  });
  it("sets 100% and actual finish for complete, falling back to the task's own dates", () => {
    const d = doc();
    injectActuals(d, new Map([[2, prog({ status: "complete", actualStart: null, actualFinish: null })]]));
    expect(tasks(d)[1].PercentComplete).toBe("100");
    expect(tasks(d)[1].ActualFinish).toBe("2025-06-06T17:00:00"); // fell back to Finish
    expect(tasks(d)[1].ActualStart).toBe("2025-06-04T08:00:00");  // fell back to Start
  });
  it("leaves not_started tasks untouched", () => {
    const d = doc();
    injectActuals(d, new Map([[3, prog({ status: "not_started" })]]));
    expect(tasks(d)[2].ActualStart).toBeUndefined();
    expect(tasks(d)[2].PercentComplete).toBe("0");
  });
  it("touches only mapped tasks", () => {
    const d = doc();
    injectActuals(d, new Map([[1, prog({ status: "in_progress", actualStart: new Date("2026-06-16T00:00:00Z") })]]));
    expect(tasks(d)[1].ActualStart).toBeUndefined();
    expect(tasks(d)[2].ActualStart).toBeUndefined();
  });
  it("handles a single (non-array) Task node", () => {
    const d = { Project: { Tasks: { Task: { UID: "1", Name: "A", Start: "2025-06-03T08:00:00", Finish: "2025-06-03T17:00:00" } } } } as Record<string, unknown>;
    injectActuals(d, new Map([[1, prog({ status: "complete" })]]));
    expect(((d.Project as any).Tasks.Task).PercentComplete).toBe("100");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/export/injectActuals.test.ts`
Expected: FAIL — `Cannot find module '@/lib/export/injectActuals'`.

- [ ] **Step 3: Implement**

Create `lib/export/injectActuals.ts`:

```ts
import { toMspdiDate } from "@/lib/export/mspdiDate";

export interface ProgressForExport {
  status: string;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number | null;
}

type AnyRec = Record<string, unknown>;

function asArray(v: unknown): AnyRec[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as AnyRec[];
}

/** Mutate matching <Task> nodes with actuals/% from the progress map; leaves everything else untouched. */
export function injectActuals(doc: AnyRec, progressByUid: Map<number, ProgressForExport>): AnyRec {
  const project = doc.Project as AnyRec | undefined;
  const tasksNode = project?.Tasks as AnyRec | undefined;
  for (const task of asArray(tasksNode?.Task)) {
    const p = progressByUid.get(Number(task.UID));
    if (!p || p.status === "not_started") continue;
    const ownStart = task.Start as string | undefined;
    const ownFinish = task.Finish as string | undefined;
    const start = p.actualStart ? toMspdiDate(p.actualStart) : ownStart;
    if (p.status === "complete") {
      task.PercentComplete = "100";
      const finish = p.actualFinish ? toMspdiDate(p.actualFinish) : ownFinish;
      if (finish) task.ActualFinish = finish;
      if (start) task.ActualStart = start;
    } else if (p.status === "in_progress") {
      if (start) task.ActualStart = start;
      if (p.percentComplete != null) task.PercentComplete = String(p.percentComplete);
    }
  }
  return doc;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/export/injectActuals.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/export/injectActuals.ts tests/export/injectActuals.test.ts
git commit -m "feat(export): inject status-driven actuals into task nodes"
```

---

## Task 3: Faithful MSPDI parse/serialize round-trip

**Files:**
- Create: `lib/export/serializeMspdi.ts`
- Test: `tests/export/serializeMspdi.test.ts`

**Interfaces:**
- Produces:
  - `parseForExport(xml: string): Record<string, unknown>` — attribute-preserving parse.
  - `buildMspdi(doc: Record<string, unknown>): string` — serialize, guaranteeing an `<?xml …?>` declaration.

- [ ] **Step 1: Write the failing round-trip fidelity test**

Create `tests/export/serializeMspdi.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseForExport, buildMspdi } from "@/lib/export/serializeMspdi";
import { injectActuals } from "@/lib/export/injectActuals";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");

function findTask(doc: Record<string, unknown>, uid: string) {
  const list = ((doc.Project as any).Tasks.Task) as any[];
  return list.find((t) => String(t.UID) === uid);
}

describe("serializeMspdi round-trip", () => {
  it("preserves the declaration, namespace, and task count through parse -> build -> parse", () => {
    const out = buildMspdi(parseForExport(xml));
    expect(out.startsWith("<?xml")).toBe(true);
    const reparsed = parseForExport(out);
    expect((reparsed.Project as any)["@_xmlns"]).toBe("http://schemas.microsoft.com/project");
    expect(((reparsed.Project as any).Tasks.Task as any[]).length).toBe(5);
  });

  it("carries injected actuals through serialization", () => {
    const doc = parseForExport(xml);
    injectActuals(doc, new Map([[2, { status: "in_progress", actualStart: new Date("2026-06-16T00:00:00Z"), actualFinish: null, percentComplete: 50 }]]));
    const reparsed = parseForExport(buildMspdi(doc));
    expect(findTask(reparsed, "2").ActualStart).toBe("2026-06-16T00:00:00");
    expect(String(findTask(reparsed, "2").PercentComplete)).toBe("50");
    // an untouched task is unchanged
    expect(String(findTask(reparsed, "1").PercentComplete)).toBe("100");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/export/serializeMspdi.test.ts`
Expected: FAIL — `Cannot find module '@/lib/export/serializeMspdi'`.

- [ ] **Step 3: Implement**

Create `lib/export/serializeMspdi.ts`:

```ts
import { XMLParser, XMLBuilder } from "fast-xml-parser";

// Attribute-preserving config so <Project xmlns="..."> survives a round-trip.
// (The importer's parseMspXml uses ignoreAttributes: true and must NOT be reused here.)
const PARSE_OPTS = { ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: false } as const;
const BUILD_OPTS = { ignoreAttributes: false, attributeNamePrefix: "@_", suppressEmptyNode: false, format: false } as const;
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export function parseForExport(xml: string): Record<string, unknown> {
  return new XMLParser(PARSE_OPTS).parse(xml) as Record<string, unknown>;
}

export function buildMspdi(doc: Record<string, unknown>): string {
  const body = new XMLBuilder(BUILD_OPTS).build(doc);
  return body.startsWith("<?xml") ? body : `${DECLARATION}\n${body}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/export/serializeMspdi.test.ts`
Expected: PASS (2 tests). If the namespace assertion fails, the parse config is wrong (`ignoreAttributes` must be `false`); if the declaration assertion fails, confirm `buildMspdi` prepends `DECLARATION`.

- [ ] **Step 5: Commit**

```bash
git add lib/export/serializeMspdi.ts tests/export/serializeMspdi.test.ts
git commit -m "feat(export): faithful MSPDI parse/serialize round-trip"
```

---

## Task 4: Export orchestrator

**Files:**
- Create: `lib/export/buildExport.ts`
- Test: `tests/export/buildExport.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`; `resolveCurrentProgress` from `@/lib/lookahead/currentProgress`; `getFinalizedEntries` from `@/lib/updates/updateService`; `injectActuals`, `ProgressForExport` from `@/lib/export/injectActuals`; `parseForExport`, `buildMspdi` from `@/lib/export/serializeMspdi`; `toMspdiDate` from `@/lib/export/mspdiDate`.
- Produces: `buildExport(projectId: string, uploadedXml: string, uploadedFileName: string): Promise<{ fileName: string; xml: string }>`.

- [ ] **Step 1: Write the failing DB-gated test**

Create `tests/export/buildExport.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { commitImport } from "@/lib/import/commitImport";
import { getOrCreateDraft, saveEntries, finalizeUpdate } from "@/lib/updates/updateService";
import { buildExport } from "@/lib/export/buildExport";
import { parseForExport } from "@/lib/export/serializeMspdi";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");
const hasDb = !!process.env.DATABASE_URL;

function findTask(doc: Record<string, unknown>, uid: string) {
  return (((doc.Project as any).Tasks.Task) as any[]).find((t) => String(t.UID) === uid);
}

describe.runIf(hasDb)("buildExport", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("injects cumulative progress and rejects bad inputs", async () => {
    const project = await prisma.project.create({ data: { name: "Export Test" } });
    projectId = project.id;
    await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });

    // no finalized progress yet -> throws
    await expect(buildExport(project.id, xml, "minimal.xml")).rejects.toThrow(/no finalized progress/i);

    // finalize an update marking UID 2 (canonicalKey "2|electrical rough-in") in progress
    const { id } = await getOrCreateDraft(project.id, "2026-06-18", 1);
    await saveEntries(id, [{ activityExternalUid: 2, canonicalActivityKey: "2|electrical rough-in", status: "in_progress", actualStart: "2026-06-16", actualFinish: null, percentComplete: 50, note: null }]);
    await finalizeUpdate(id);

    const out = await buildExport(project.id, xml, "minimal.xml");
    expect(out.fileName).toBe("minimal-updated-2026-06-18.xml");
    const doc = parseForExport(out.xml);
    expect(findTask(doc, "2").ActualStart).toBe("2026-06-16T00:00:00");
    expect(String(findTask(doc, "2").PercentComplete)).toBe("50");
    expect((doc.Project as any).StatusDate).toBe("2026-06-18T00:00:00");

    // hash mismatch -> throws
    await expect(buildExport(project.id, xml + "<!-- changed -->", "minimal.xml")).rejects.toThrow(/match/i);
  }, 30000);

  it("throws when the project has no import", async () => {
    const p = await prisma.project.create({ data: { name: "No Import Export" } });
    await expect(buildExport(p.id, xml, "minimal.xml")).rejects.toThrow(/no imported schedule/i);
    await prisma.project.delete({ where: { id: p.id } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/export/buildExport.test.ts`
Expected: FAIL — `Cannot find module '@/lib/export/buildExport'` (or `1 skipped` without `DATABASE_URL`; set one to exercise this task).

- [ ] **Step 3: Implement**

Create `lib/export/buildExport.ts`:

```ts
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { injectActuals, type ProgressForExport } from "@/lib/export/injectActuals";
import { parseForExport, buildMspdi } from "@/lib/export/serializeMspdi";
import { toMspdiDate } from "@/lib/export/mspdiDate";

export async function buildExport(
  projectId: string,
  uploadedXml: string,
  uploadedFileName: string,
): Promise<{ fileName: string; xml: string }> {
  const fileHash = crypto.createHash("sha256").update(uploadedXml).digest("hex");

  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  if (!latest) throw new Error("No imported schedule to export.");
  if (latest.fileHash !== fileHash) {
    throw new Error("This file doesn't match the current imported schedule — export the file you most recently imported.");
  }

  const current = resolveCurrentProgress(await getFinalizedEntries(projectId));
  if (current.size === 0) throw new Error("No finalized progress to export yet.");

  const progressByUid = new Map<number, ProgressForExport>();
  for (const a of latest.activities) {
    const p = current.get(a.canonicalActivityKey);
    if (p) progressByUid.set(a.externalUid, { status: p.status, actualStart: p.actualStart, actualFinish: p.actualFinish, percentComplete: p.percentComplete });
  }

  const latestUpdate = await prisma.progressUpdate.findFirst({
    where: { projectId, state: "finalized" },
    orderBy: { asOfDate: "desc" },
  });

  const doc = parseForExport(uploadedXml);
  injectActuals(doc, progressByUid);
  const project = doc.Project as Record<string, unknown> | undefined;
  if (project && latestUpdate) project.StatusDate = toMspdiDate(latestUpdate.asOfDate);
  const xml = buildMspdi(doc);

  const asOf = (latestUpdate?.asOfDate ?? new Date()).toISOString().slice(0, 10);
  const base = uploadedFileName.replace(/\.xml$/i, "");
  return { fileName: `${base}-updated-${asOf}.xml`, xml };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/export/buildExport.test.ts`
Expected: PASS (2 tests) when `DATABASE_URL` is set.

- [ ] **Step 5: Commit**

```bash
git add lib/export/buildExport.ts tests/export/buildExport.test.ts
git commit -m "feat(export): orchestrate hash-match, progress map, inject, and serialize"
```

---

## Task 5: Export API route

**Files:**
- Create: `app/api/export/route.ts`
- Test: extend `tests/export/buildExport.test.ts` with a route handler test

**Interfaces:**
- Consumes: `buildExport` from `@/lib/export/buildExport`.
- Produces: `POST(req: Request)` — returns the `.xml` as an attachment (200, `application/xml`) or `{ error: { message } }` JSON (422 on guard failure, 400 on missing inputs).

- [ ] **Step 1: Write the failing route test**

Append to `tests/export/buildExport.test.ts`, inside the `describe.runIf(hasDb)` block after the existing tests:

```ts
  it("route returns the updated xml as an attachment", async () => {
    const { POST } = await import("@/app/api/export/route");
    const project = await prisma.project.create({ data: { name: "Export Route Test" } });
    await commitImport({ projectId: project.id, fileName: "minimal.xml", xml });
    const { id } = await getOrCreateDraft(project.id, "2026-06-18", 1);
    await saveEntries(id, [{ activityExternalUid: 2, canonicalActivityKey: "2|electrical rough-in", status: "complete", actualStart: "2026-06-16", actualFinish: "2026-06-18", percentComplete: 100, note: null }]);
    await finalizeUpdate(id);

    const fd = new FormData();
    fd.append("file", new File([xml], "minimal.xml", { type: "application/xml" }));
    fd.append("projectId", project.id);
    const res = await POST(new Request("http://localhost/api/export", { method: "POST", body: fd }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/xml");
    expect(res.headers.get("Content-Disposition")).toContain("minimal-updated-2026-06-18.xml");
    const body = await res.text();
    expect(body).toContain("<ActualFinish>2026-06-18T00:00:00</ActualFinish>");

    await prisma.project.delete({ where: { id: project.id } });
  }, 30000);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/export/buildExport.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/export/route'` (or skipped without `DATABASE_URL`).

- [ ] **Step 3: Implement**

Create `app/api/export/route.ts`:

```ts
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
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Export failed.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/export/buildExport.test.ts`
Expected: PASS (3 tests) when `DATABASE_URL` is set.

- [ ] **Step 5: Commit**

```bash
git add app/api/export/route.ts tests/export/buildExport.test.ts
git commit -m "feat(export): API route returning the updated MS Project file"
```

---

## Task 6: Export page, panel, and nav link

**Files:**
- Create: `components/ExportPanel.tsx`
- Create: `app/projects/[id]/export/page.tsx`
- Modify: `app/projects/[id]/page.tsx` (add nav button to the existing cluster)

**Interfaces:**
- Consumes: `resolveCurrentProgress` from `@/lib/lookahead/currentProgress`; `getFinalizedEntries` from `@/lib/updates/updateService`. Posts to `POST /api/export`.

- [ ] **Step 1: Implement the client panel**

Create `components/ExportPanel.tsx`:

```tsx
"use client";

import { useState } from "react";

export function ExportPanel({ projectId }: { projectId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!file) return;
    setBusy(true);
    setError(null);
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
    </div>
  );
}
```

- [ ] **Step 2: Implement the export page**

Create `app/projects/[id]/export/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { ExportPanel } from "@/components/ExportPanel";

export const dynamic = "force-dynamic";

export default async function ExportPage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const latest = await prisma.scheduleImport.findFirst({ where: { projectId: project.id }, orderBy: { importedAt: "desc" } });
  const current = resolveCurrentProgress(await getFinalizedEntries(project.id));
  let complete = 0;
  let inProgress = 0;
  for (const p of current.values()) {
    if (p.status === "complete") complete++;
    else if (p.status === "in_progress") inProgress++;
  }

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Export to MS Project</h1>
      {!latest ? (
        <p className="text-slate-500">Import a schedule first.</p>
      ) : current.size === 0 ? (
        <p className="text-slate-500">No finalized progress to export yet. Finalize a weekly update first.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">
            {current.size} activities have reported progress — {complete} complete, {inProgress} in progress.
            Re-upload <span className="font-medium">{latest.fileName}</span> to inject these actuals.
          </p>
          <ExportPanel projectId={project.id} />
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Add the nav button to the project page**

In `app/projects/[id]/page.tsx`, the cluster currently holds two links (Weekly updates, Import schedule). Add an Export link as the first button:

```tsx
        <div className="flex gap-2">
          <Link href={`/projects/${project.id}/export`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Export to MS Project
          </Link>
          <Link href={`/projects/${project.id}/updates`} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Weekly updates
          </Link>
          <Link href={`/projects/${project.id}/import`} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            Import schedule
          </Link>
        </div>
```

- [ ] **Step 4: Full test + build gate**

Run: `npm run test && npm run build`
Expected: tests PASS (unit always; DB-gated pass with `DATABASE_URL`, else skipped); BUILD exit 0 with route `/projects/[id]/export` present.

- [ ] **Step 5: Commit**

```bash
git add components/ExportPanel.tsx "app/projects/[id]/export/page.tsx" "app/projects/[id]/page.tsx"
git commit -m "feat(export): export page, upload/download panel, and nav link"
```

---

## Manual Smoke Test (after Task 6, against a deployed or local DB)

1. Log in. Open a project with an imported schedule and at least one finalized weekly update.
2. Click **Export to MS Project** → confirm the summary counts look right.
3. Re-upload the exact `.xml` you imported → **Generate updated file** → a `<name>-updated-<date>.xml` downloads.
4. Open the downloaded file (or re-import it): confirm the activities you marked carry `ActualStart`/`ActualFinish`/`PercentComplete`, and the project `StatusDate` matches the latest update's as-of date.
5. Upload a *different* file → confirm the inline "doesn't match" error.

---

## Self-Review

- **Spec coverage:** §4 no schema change → Task 1–6 (none add tables). §5 hash-match + UID→key→progress mapping → Task 4. §6.1 inject rules → Task 2. §6.2 date mapping → Task 1. §6.3 serialization + fidelity → Task 3. §6.4 StatusDate → Task 4. §7 flow/routes/components → Tasks 5, 6. §8 telemetry → opt-out, no code. §9 testing tiers → unit (Tasks 1–3), DB-gated (Tasks 4, 5), smoke (manual). Non-goals respected: no recompute, no notes, no stored XML, MSPDI only.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `ProgressForExport` defined in Task 2, consumed in Tasks 3, 4; `parseForExport`/`buildMspdi` defined in Task 3, consumed in Tasks 4 and tests; `buildExport` signature `(projectId, uploadedXml, uploadedFileName)` consistent across Tasks 4–5; `toMspdiDate` from Task 1 used in Tasks 2, 4. Status literals (`complete`/`in_progress`/`not_started`) match Slice 2.
```
