# Two-Tab Shell Implementation Plan (Redesign Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the six flat buttons with a two-tab workspace — Schedule (stat strip + actions + existing activity body) and Data Health (naming, granularity, trades merged into one badged triage page with import) — with old routes redirecting in.

**Architecture:** One new count aggregator (`lib/health/dataHealthCounts.ts`) feeds the tab badge; three small presentational components (`ProjectTabs`, `StatStrip`, `ExportMenu`) form the shell; the three hygiene pages' server loaders move verbatim into `/projects/[id]/data` and the old pages become redirects; the Schedule page swaps its chrome but keeps its data pipeline and `ActivityTable` body untouched (phase 3 replaces the body). Spec: `docs/superpowers/specs/2026-08-03-schedule-ui-redesign-design.md`, Section 2.

**Tech Stack:** Next.js 14 App Router (server components except where noted), Tailwind, Vitest (+ happy-dom component tests per `tests/components/` conventions), Prisma.

## Global Constraints

- TypeScript strict mode; never `any`. No `console.log` in server-side code.
- Exact copy from the spec: tabs are **"Schedule"** (default) and **"Data Health"**; primary action **"Update progress"**; secondary **"Export ▾"** menu containing **"MS Project XML"** (the *Lookahead PDF* items land in phase 4, not now). Last-update stat turns amber when **more than 7 days** stale.
- Routes: Schedule tab at `/projects/[id]`, Data Health at `/projects/[id]/data`. Old routes `/normalize`, `/completeness`, `/trades` **redirect** to `/data`. `/updates`, `/export`, `/import`, `/health` keep their pages — they leave the main nav path but remain reachable (updates ← last-update stat; export ← Export menu; import ← Data Health; health ← % complete stat).
- **Preserve existing behavior**: `ActivityTable` body, import wizard mechanics, update finalize flow, accept/dismiss endpoints, AT RISK semantics, procurement freshness line, admin reset (relocated to Data Health) — all unchanged. Existing tests must stay green.
- Deliberate phase-2 deviations (approved design intent): the drift and at-risk stats render unlinked — their link targets (body sorted-by-drift / filtered-to-flagged) require the phase 3 body. The `WizardBanner` three-page stepper is deleted; a single setup banner on the Data Health page (shown at `?wizard=1`) replaces it because all its steps now live on one page.
- All forecast numbers come from `getProjectForecast(projectId)` (`lib/forecast/getProjectForecast.ts`) — never recompute drift locally.
- Commit directly to `master` (repo convention). Run `npm run build` and `npm test` before finishing.
- Component tests: first line `// @vitest-environment happy-dom`, `@testing-library/react` with `cleanup()` in `afterEach` — follow `tests/components/ActivityTable.test.tsx`. If rendering `next/link` in happy-dom throws about a missing router, wrap the render in `AppRouterContext.Provider` from `next/dist/shared/lib/app-router-context.shared-runtime` with a stub value — but try the bare render first; `next/link` normally renders a plain `<a>` without router context.

---

### Task 1: Data-health open-item counts

**Files:**
- Create: `lib/health/dataHealthCounts.ts`
- Test: `tests/health/dataHealthCounts.test.ts` (DB-gated)

**Interfaces:**
- Consumes: `applyDictionary`, `getDictionary` from `@/lib/normalize/normalizationService`; `normalizeName` from `@/lib/normalize/normalizeName`; `getCompleteness` from `@/lib/completeness/completenessService`; `getTradeDictionary`, `getDismissedScopes` from `@/lib/trades/tradesService`; `applyTradeDictionaryWith` from `@/lib/trades/applyTradeDictionary`; `prisma` from `@/lib/db`.
- Produces (Tasks 3 and 4 rely on exactly this):

```ts
export interface DataHealthCounts {
  naming: number;      // activity names with no dictionary mapping
  granularity: number; // activities flagged too coarse
  trades: number;      // mapped scopes with no discipline, minus dismissed
  total: number;
}
export async function getDataHealthCounts(projectId: string): Promise<DataHealthCounts>;
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/health/dataHealthCounts.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getDataHealthCounts } from "@/lib/health/dataHealthCounts";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("getDataHealthCounts", () => {
  let projectId = "";
  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    await prisma.$disconnect();
  });

  it("is all zeros with no import, and counts an unmapped name after one", async () => {
    const project = await prisma.project.create({ data: { name: "Data Health Counts Test" } });
    projectId = project.id;
    expect(await getDataHealthCounts(project.id)).toEqual({ naming: 0, granularity: 0, trades: 0, total: 0 });

    const imp = await prisma.scheduleImport.create({
      data: { projectId: project.id, sourceFormat: "msproject_xml", fileName: "x.xml", fileHash: "h" },
    });
    // A name no shared dictionary will ever map — counts as one naming item.
    await prisma.activity.create({
      data: {
        scheduleImportId: imp.id, externalUid: 1, canonicalActivityKey: "1|zz",
        name: "zz-dhc-test-unmappable-scope-7f3a", type: "task",
      },
    });

    const counts = await getDataHealthCounts(project.id);
    expect(counts.naming).toBe(1);
    // Unmapped name -> its scope never resolves -> it cannot create a trades item.
    expect(counts.trades).toBe(0);
    expect(counts.total).toBe(counts.naming + counts.granularity + counts.trades);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/health/dataHealthCounts.test.ts`
Expected: FAIL (module missing) when `DATABASE_URL` is set; auto-skips without it (a `.env` with `DATABASE_URL` exists in this repo, so it should run).

- [ ] **Step 3: Implement**

```ts
// lib/health/dataHealthCounts.ts
import { prisma } from "@/lib/db";
import { applyDictionary, getDictionary } from "@/lib/normalize/normalizationService";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { getCompleteness } from "@/lib/completeness/completenessService";
import { getTradeDictionary, getDismissedScopes } from "@/lib/trades/tradesService";
import { applyTradeDictionaryWith } from "@/lib/trades/applyTradeDictionary";

export interface DataHealthCounts {
  naming: number;
  granularity: number;
  trades: number;
  total: number;
}

/**
 * Open-item counts for the Data Health tab badge — the same three queues the
 * tab's sections show: unmapped activity names, coarse-activity flags, and
 * unassigned (undismissed) scopes. Loud after an import, zero when clean.
 */
export async function getDataHealthCounts(projectId: string): Promise<DataHealthCounts> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  const leaves = (latest?.activities ?? []).filter(
    (a) => a.type !== "summary" && a.type !== "project_summary",
  );

  const { unmappedNames } = await applyDictionary(leaves);

  const completeness = await getCompleteness(projectId);
  const granularity = completeness.hasImport ? completeness.issues.length : 0;

  const scopeDict = await getDictionary();
  const scopesPresent = new Set<string>();
  for (const a of leaves) {
    const scope = scopeDict.get(normalizeName(a.name));
    if (scope) scopesPresent.add(scope);
  }
  const { unmappedScopes } = applyTradeDictionaryWith([...scopesPresent], await getTradeDictionary());
  const dismissed = new Set(await getDismissedScopes(projectId));
  const trades = unmappedScopes.filter((s) => !dismissed.has(s)).length;

  const naming = unmappedNames.length;
  return { naming, granularity, trades, total: naming + granularity + trades };
}
```

(This re-runs the same service calls the old pages made; the Data Health page derives its own section counts from data it already loads, and both go through the same services so they agree by construction.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/health/dataHealthCounts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/health/dataHealthCounts.ts tests/health/dataHealthCounts.test.ts
git commit -m "feat(shell): open-item counts behind the Data Health tab badge"
```

---

### Task 2: Shell components — ProjectTabs, StatStrip, ExportMenu

**Files:**
- Create: `components/ProjectTabs.tsx`
- Create: `components/StatStrip.tsx`
- Create: `components/ExportMenu.tsx`
- Test: `tests/components/ShellComponents.test.tsx`

**Interfaces:**
- Consumes: `next/link` only — all three are synchronous server-renderable presentational components (no `"use client"`, no hooks).
- Produces (Tasks 3 and 4 render exactly these):

```tsx
export function ProjectTabs(props: { projectId: string; active: "schedule" | "data"; dataBadge: number }): JSX.Element;

export interface StatStripProps {
  projectId: string;
  driftDays: number;
  atRiskCount: number;
  percentComplete: number;
  lastUpdate: { daysAgo: number } | null; // null = no finalized update yet
}
export function StatStrip(props: StatStripProps): JSX.Element;

export function ExportMenu(props: { projectId: string }): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/ShellComponents.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ProjectTabs } from "@/components/ProjectTabs";
import { StatStrip } from "@/components/StatStrip";
import { ExportMenu } from "@/components/ExportMenu";

afterEach(() => cleanup());

describe("ProjectTabs", () => {
  it("links both tabs and shows the badge when items are open", () => {
    render(<ProjectTabs projectId="p1" active="schedule" dataBadge={14} />);
    const links = screen.getAllByRole("link");
    expect(links[0].getAttribute("href")).toBe("/projects/p1");
    expect(links[1].getAttribute("href")).toBe("/projects/p1/data");
    expect(screen.getByText("14")).toBeTruthy();
  });
  it("hides the badge at zero", () => {
    render(<ProjectTabs projectId="p1" active="data" dataBadge={0} />);
    expect(screen.queryByText("0")).toBeNull();
  });
});

describe("StatStrip", () => {
  it("shows positive drift as +Nd and links % complete and last update", () => {
    render(<StatStrip projectId="p1" driftDays={3} atRiskCount={4} percentComplete={62} lastUpdate={{ daysAgo: 6 }} />);
    expect(screen.getByText("+3d")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("62%").closest("a")!.getAttribute("href")).toBe("/projects/p1/health");
    expect(screen.getByText("6d ago").closest("a")!.getAttribute("href")).toBe("/projects/p1/updates");
  });
  it("reads on plan at zero drift and goes amber past 7 days stale", () => {
    render(<StatStrip projectId="p1" driftDays={0} atRiskCount={0} percentComplete={10} lastUpdate={{ daysAgo: 14 }} />);
    expect(screen.getByText("on plan")).toBeTruthy();
    const stale = screen.getByText("14d ago");
    expect(stale.className).toContain("text-amber-700");
  });
  it("says never when no update has been finalized", () => {
    render(<StatStrip projectId="p1" driftDays={0} atRiskCount={0} percentComplete={0} lastUpdate={null} />);
    expect(screen.getByText("never")).toBeTruthy();
  });
});

describe("ExportMenu", () => {
  it("contains the MS Project XML item linking to the export page", () => {
    render(<ExportMenu projectId="p1" />);
    expect(screen.getByText("MS Project XML").closest("a")!.getAttribute("href")).toBe("/projects/p1/export");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/ShellComponents.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement all three components**

```tsx
// components/ProjectTabs.tsx
import Link from "next/link";

// The two-workspace shell (spec §2): Schedule is the weekly rhythm, Data
// Health is the post-import hygiene burst; the badge is that burst's loudness.
export function ProjectTabs({ projectId, active, dataBadge }: { projectId: string; active: "schedule" | "data"; dataBadge: number }) {
  const base = "border-b-2 px-4 py-2 text-sm font-medium";
  const on = "border-cyan-700 text-cyan-800";
  const off = "border-transparent text-slate-500 hover:text-slate-800";
  return (
    <nav className="mb-4 flex border-b border-slate-200">
      <Link href={`/projects/${projectId}`} className={`${base} ${active === "schedule" ? on : off}`}>
        Schedule
      </Link>
      <Link href={`/projects/${projectId}/data`} className={`${base} ${active === "data" ? on : off}`}>
        Data Health
        {dataBadge > 0 && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{dataBadge}</span>
        )}
      </Link>
    </nav>
  );
}
```

```tsx
// components/StatStrip.tsx
import Link from "next/link";

export interface StatStripProps {
  projectId: string;
  driftDays: number;
  atRiskCount: number;
  percentComplete: number;
  lastUpdate: { daysAgo: number } | null;
}

// Drift and at-risk are plain stats for now — their link targets (body sorted
// by drift / filtered to flagged) arrive with the phase 3 schedule body.
export function StatStrip({ projectId, driftDays, atRiskCount, percentComplete, lastUpdate }: StatStripProps) {
  const stale = lastUpdate !== null && lastUpdate.daysAgo > 7;
  const box = "rounded border p-3 text-center";
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className={`${box} border-slate-200 bg-white`}>
        <div className={`text-xl font-bold ${driftDays > 0 ? "text-red-600" : "text-slate-900"}`}>
          {driftDays > 0 ? `+${driftDays}d` : "on plan"}
        </div>
        <div className="text-xs text-slate-500">projected drift</div>
      </div>
      <div className={`${box} border-slate-200 bg-white`}>
        <div className={`text-xl font-bold ${atRiskCount > 0 ? "text-amber-700" : "text-slate-900"}`}>{atRiskCount}</div>
        <div className="text-xs text-slate-500">at risk</div>
      </div>
      <Link href={`/projects/${projectId}/health`} className={`${box} border-slate-200 bg-white hover:bg-slate-50`}>
        <div className="text-xl font-bold text-slate-900">{percentComplete}%</div>
        <div className="text-xs text-slate-500">complete</div>
      </Link>
      <Link
        href={`/projects/${projectId}/updates`}
        className={`${box} hover:bg-slate-50 ${stale ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
      >
        <div className={`text-xl font-bold ${stale ? "text-amber-700" : "text-slate-900"}`}>
          {lastUpdate ? `${lastUpdate.daysAgo}d ago` : "never"}
        </div>
        <div className="text-xs text-slate-500">last update</div>
      </Link>
    </div>
  );
}
```

```tsx
// components/ExportMenu.tsx
import Link from "next/link";

// Record-keeping and meeting output live together (spec §2). A native
// <details> dropdown — no client JS. Phase 4 adds the Lookahead PDF items.
export function ExportMenu({ projectId }: { projectId: string }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        Export ▾
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
        <Link href={`/projects/${projectId}/export`} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          MS Project XML
        </Link>
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/components/ShellComponents.test.tsx`
Expected: PASS (see Global Constraints for the `next/link` happy-dom fallback if the bare render throws).

- [ ] **Step 5: Commit**

```bash
git add components/ProjectTabs.tsx components/StatStrip.tsx components/ExportMenu.tsx tests/components/ShellComponents.test.tsx
git commit -m "feat(shell): tabs, stat strip, and export menu components"
```

---

### Task 3: Data Health tab — consolidation, redirects, wizard fold-in

**Files:**
- Create: `app/projects/[id]/data/page.tsx`
- Modify: `app/projects/[id]/normalize/page.tsx` (becomes a redirect)
- Modify: `app/projects/[id]/completeness/page.tsx` (becomes a redirect)
- Modify: `app/projects/[id]/trades/page.tsx` (becomes a redirect)
- Modify: `components/ImportWizard.tsx:56` (post-commit navigation target)
- Modify: `app/projects/[id]/health/page.tsx` (remove `WizardBanner` import + conditional render + now-unused `searchParams.wizard` handling)
- Delete: `components/WizardBanner.tsx`, `tests/components/WizardBanner.test.tsx`
- Test: existing suites (`tests/components`, `tests/normalize`, `tests/completeness`, `tests/trades`) must stay green — this task moves markup, not logic.

**Interfaces:**
- Consumes: `ProjectTabs` from Task 2; every panel and service the three old pages already use (imports listed in the code below — signatures unchanged); `ResetProjectButton` from `@/components/ResetProjectButton`; `appPath` from `@/lib/http`.
- Produces: `/projects/[id]/data` — the page Tasks 4's tab links to. Old hygiene URLs 307-redirect there.

- [ ] **Step 1: Write the Data Health page**

The three loader blocks below are moved **verbatim** from the old pages (normalize/page.tsx:23-57, completeness/page.tsx:24-32, trades/page.tsx:25-72) — do not rework their logic.

```tsx
// app/projects/[id]/data/page.tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { appPath } from "@/lib/http";
import { ADMIN_SESSION_COOKIE } from "@/lib/auth";
import { SCOPE_COOKIE, isAdminFromCookies } from "@/lib/scope";
import { applyDictionary, getKnownScopes, getDictionary } from "@/lib/normalize/normalizationService";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { suggestScopes } from "@/lib/normalize/suggestScopes";
import { getCompleteness } from "@/lib/completeness/completenessService";
import { getSplitRules } from "@/lib/completeness/splitRuleService";
import {
  getTradeDictionary,
  getProjectDisciplines,
  getPartnersForDiscipline,
  getProjectAssignments,
  getDismissedScopes,
} from "@/lib/trades/tradesService";
import { applyTradeDictionaryWith } from "@/lib/trades/applyTradeDictionary";
import { getTradeDrift } from "@/lib/trades/tradeDrift";
import { NormalizePanel, type UnmappedRow } from "@/components/NormalizePanel";
import { DictionaryPanel, type MappedRow } from "@/components/DictionaryPanel";
import { CompletenessIssuesTable } from "@/components/CompletenessIssuesTable";
import { CoarsePanel } from "@/components/CoarsePanel";
import { SplitRulesPanel, type SplitRuleRow } from "@/components/SplitRulesPanel";
import { TradesPanel, type DisciplineRow, type AssignmentRow } from "@/components/TradesPanel";
import { ProjectTabs } from "@/components/ProjectTabs";
import { ResetProjectButton } from "@/components/ResetProjectButton";

export const dynamic = "force-dynamic";

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  // Sections with open items start expanded; clean ones start collapsed.
  return (
    <details open={count > 0} className="mb-4 rounded border border-slate-200 bg-white">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 font-medium">
        <span>{title}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${count > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>
          {count > 0 ? `${count} open` : "clean"}
        </span>
      </summary>
      <div className="border-t border-slate-200 p-4">{children}</div>
    </details>
  );
}

export default async function DataHealthPage(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ wizard?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId: project.id },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  const leaves = (latest?.activities ?? []).filter((a) => a.type !== "summary" && a.type !== "project_summary");

  const jar = await cookies();
  const adminSession = await isAdminFromCookies(
    jar.get(ADMIN_SESSION_COOKIE)?.value,
    jar.get(SCOPE_COOKIE)?.value,
    Math.floor(Date.now() / 1000)
  );

  // --- Task Naming (moved verbatim from normalize/page.tsx) ---
  const { mapped, unmappedNames } = await applyDictionary(leaves);
  const knownScopes = await getKnownScopes();
  const nameCounts = new Map<string, number>();
  for (const a of leaves) {
    const key = a.name.trim();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const namingRows: UnmappedRow[] = unmappedNames.map((name) => ({
    rawName: name,
    count: nameCounts.get(name) ?? 1,
    suggestions: suggestScopes(name, knownScopes),
  }));
  const mappedRows: MappedRow[] = [
    ...new Map(
      mapped.map(({ activity, canonicalScope }) => {
        const rawName = activity.name.trim();
        return [rawName, { rawName, canonicalScope, count: nameCounts.get(rawName) ?? 1 }] as const;
      })
    ).values(),
  ].sort((a, b) => a.canonicalScope.localeCompare(b.canonicalScope));

  // --- Task Granularity (moved verbatim from completeness/page.tsx) ---
  const completeness = await getCompleteness(project.id);
  const splitRulesMap = await getSplitRules();
  const splitRules: SplitRuleRow[] = [...splitRulesMap.entries()].map(([coarseScope, finerScopes]) => ({ coarseScope, finerScopes }));

  // --- Trades (moved verbatim from trades/page.tsx) ---
  const scopeDict = await getDictionary();
  const scopesPresent = new Set<string>();
  let unnormalizedCount = 0;
  for (const a of leaves) {
    const scope = scopeDict.get(normalizeName(a.name));
    if (scope) scopesPresent.add(scope);
    else unnormalizedCount++;
  }
  const tradeDict = await getTradeDictionary();
  const { mapped: tradesMapped, unmappedScopes } = applyTradeDictionaryWith([...scopesPresent], tradeDict);
  const disciplines = await getProjectDisciplines(project.id);
  const assignments = await getProjectAssignments(project.id);
  const dismissedScopes = await getDismissedScopes(project.id);
  const driftRows = await getTradeDrift(project.id);
  const dismissed = new Set(dismissedScopes);
  const reviewScopes = unmappedScopes.filter((scope) => !dismissed.has(scope));
  const byName = new Map(disciplines.map((d) => [d.name, d]));
  const disciplineRows: DisciplineRow[] = reviewScopes.map((scope) => ({
    canonicalScope: scope,
    suggestions: suggestScopes(scope, [...byName.keys()])
      .map((name) => byName.get(name))
      .filter((d): d is NonNullable<typeof d> => Boolean(d)),
  }));
  const presentIds = [...new Map(tradesMapped.map((m) => [m.discipline.id, m.discipline])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const assignmentRows: AssignmentRow[] = await Promise.all(
    presentIds.map(async (discipline) => {
      const assigned = assignments.get(discipline.id);
      return {
        osDisciplineId: discipline.id,
        disciplineName: discipline.name,
        currentPartnerId: assigned?.osPartnerId ?? null,
        currentPartnerName: assigned?.name ?? "",
        onRoster: assigned?.onRoster ?? true,
        partners: await getPartnersForDiscipline(project.id, discipline.id),
      };
    })
  );

  const granularityCount = completeness.hasImport ? completeness.issues.length : 0;
  const badge = namingRows.length + granularityCount + disciplineRows.length;

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <ProjectTabs projectId={project.id} active="data" dataBadge={badge} />

      {searchParams.wizard === "1" && !project.onboardingCompletedAt && (
        <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm">
          <div className="mb-1 font-medium text-blue-900">First-time setup</div>
          <p className="mb-2 text-blue-800">
            Work through the sections below in order — split coarse activities first (a scope you are
            going to split is not worth naming twice), then confirm standard names, then assign trades.
            Finish when every section reads clean.
          </p>
          <form action={appPath(`/api/projects/${project.id}/complete-onboarding`)} method="POST">
            <button type="submit" className="rounded bg-blue-900 px-3 py-1.5 text-xs font-medium text-white">
              Finish setup
            </button>
          </form>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white p-3 text-sm text-slate-600">
        {latest ? (
          <div>
            <div>File: {latest.fileName}</div>
            <div>Imported: {latest.importedAt.toISOString().slice(0, 16).replace("T", " ")}</div>
            <div>Status date: {latest.statusDate ? latest.statusDate.toISOString().slice(0, 10) : "—"}</div>
            <div>{latest.isBaseline ? "Baseline import" : "Update import"} · {latest.activityCount} activities · {latest.relationshipCount} relationships</div>
          </div>
        ) : (
          <p className="text-slate-500">No schedule imported yet.</p>
        )}
        <Link href={`/projects/${project.id}/import`} className="rounded-lg bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-800">
          Import Schedule
        </Link>
      </div>

      {latest && (
        <>
          <Section title="Task Granularity" count={granularityCount}>
            {!completeness.hasImport || completeness.issues.length === 0 ? (
              <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">No coarse activities flagged.</p>
            ) : (
              <CompletenessIssuesTable projectId={project.id} issues={completeness.issues} />
            )}
            {completeness.hasImport && (
              <div className="mt-6">
                <CoarsePanel rows={completeness.names} isAdmin={adminSession} />
              </div>
            )}
            <div className="mt-6">
              <SplitRulesPanel rules={splitRules} isAdmin={adminSession} />
            </div>
          </Section>

          <Section title="Task Naming" count={namingRows.length}>
            <p className="mb-3 text-sm text-slate-500">{mapped.length} activities already mapped · {namingRows.length} names to review</p>
            {namingRows.length === 0 ? (
              <p className="text-slate-500">All activity names are mapped.</p>
            ) : (
              <NormalizePanel rows={namingRows} knownScopes={knownScopes} />
            )}
            {mappedRows.length > 0 && (
              <div className="mt-6">
                <DictionaryPanel rows={mappedRows} isAdmin={adminSession} />
              </div>
            )}
          </Section>

          <Section title="Trades" count={disciplineRows.length}>
            <p className="mb-3 text-sm text-slate-500">
              {tradesMapped.length} scopes mapped to a discipline · {disciplineRows.length} to review
              {unnormalizedCount > 0 ? ` · ${unnormalizedCount} activities need naming first` : ""}
            </p>
            <TradesPanel
              projectId={project.id}
              disciplineRows={disciplineRows}
              assignmentRows={assignmentRows}
              disciplines={disciplines}
              dismissedScopes={dismissedScopes}
              driftRows={driftRows}
            />
          </Section>
        </>
      )}

      {adminSession && (
        <div className="mt-8 border-t border-slate-200 pt-4">
          <ResetProjectButton projectId={project.id} projectName={project.name} />
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Turn the three old pages into redirects**

Replace the entire contents of each file:

```tsx
// app/projects/[id]/normalize/page.tsx
import { redirect } from "next/navigation";

// Task Naming now lives on the Data Health tab (redesign phase 2).
export default async function NormalizePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  redirect(`/projects/${id}/data`);
}
```

```tsx
// app/projects/[id]/completeness/page.tsx
import { redirect } from "next/navigation";

// Task Granularity now lives on the Data Health tab (redesign phase 2).
export default async function CompletenessPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  redirect(`/projects/${id}/data`);
}
```

```tsx
// app/projects/[id]/trades/page.tsx
import { redirect } from "next/navigation";

// Trades now lives on the Data Health tab (redesign phase 2).
export default async function TradesPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  redirect(`/projects/${id}/data`);
}
```

- [ ] **Step 3: Rewire the import wizard and retire WizardBanner**

In `components/ImportWizard.tsx:56`, change the post-commit navigation:

```ts
    router.push(data.startWizard ? `/projects/${projectId}/data?wizard=1` : `/projects/${projectId}`);
```

In `app/projects/[id]/health/page.tsx`: remove the `WizardBanner` import (line 6), the `{searchParams.wizard === "1" && <WizardBanner ... />}` block (around line 33), and — if `searchParams` is then unused — its prop and the `await props.searchParams` line. The rest of the health page is untouched.

Delete the retired stepper:

```bash
rm components/WizardBanner.tsx tests/components/WizardBanner.test.tsx
```

Then confirm nothing else references it: `grep -rn "WizardBanner" app components tests lib` must return nothing.

- [ ] **Step 4: Verify**

Run: `npm run build && npx vitest run tests/components tests/normalize tests/completeness tests/trades`
Expected: build clean (this catches unused imports and the removed searchParams), all suites green.

- [ ] **Step 5: Commit**

```bash
git add -A app/projects components/ImportWizard.tsx components/WizardBanner.tsx tests/components/WizardBanner.test.tsx
git commit -m "feat(shell): consolidate naming, granularity, and trades into the Data Health tab"
```

---

### Task 4: Schedule tab rework

**Files:**
- Modify: `app/projects/[id]/page.tsx` (chrome swap; data pipeline and `ActivityTable` untouched)
- Test: `npm run build` + full suite (page is a server component; its pieces are unit-tested in Tasks 1–2 and the untouched `ActivityTable` suite)

**Interfaces:**
- Consumes: `ProjectTabs`, `StatStrip`, `ExportMenu` (Task 2); `getDataHealthCounts` (Task 1); `getProjectForecast` from `@/lib/forecast/getProjectForecast`; `appPath` from `@/lib/http`; everything the page already imports for its rows pipeline.
- Produces: the Schedule tab — default project view.

- [ ] **Step 1: Rework the page**

Keep lines 27–121 of the current `app/projects/[id]/page.tsx` (project load through `rows` construction) exactly as they are. Make these changes around them:

**Imports** — remove `Link` (no longer used after the button row goes), `ADMIN_SESSION_COOKIE`, `isAdminFromCookies`, `ResetProjectButton` (reset moved to Data Health; also delete the `jar`/`adminSession` lines and the `{adminSession && ...}` footer block); add:

```tsx
import { appPath } from "@/lib/http";
import { getProjectForecast } from "@/lib/forecast/getProjectForecast";
import { getDataHealthCounts } from "@/lib/health/dataHealthCounts";
import { ProjectTabs } from "@/components/ProjectTabs";
import { StatStrip } from "@/components/StatStrip";
import { ExportMenu } from "@/components/ExportMenu";
```

Note: `SCOPE_COOKIE`/`cookies` were only used for `adminSession` — remove them too if nothing else on the page uses them after the edit (the build will tell you).

**After the `rows` construction**, add the stat data:

```tsx
  const forecast = await getProjectForecast(project.id);
  const dataCounts = await getDataHealthCounts(project.id);
  const lastFinalized = await prisma.progressUpdate.findFirst({
    where: { projectId: project.id, state: "finalized" },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });
  const lastUpdate = lastFinalized
    ? { daysAgo: Math.max(0, Math.floor((Date.now() - lastFinalized.asOfDate.getTime()) / 86_400_000)) }
    : null;
  const atRiskCount = rows.filter((r) => r.atRisk).length;
```

**Replace the returned JSX** (everything from `return (` down) with:

```tsx
  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <ProjectTabs projectId={project.id} active="schedule" dataBadge={dataCounts.total} />

      {!latest ? (
        <p className="text-slate-500">
          No schedule imported yet — import one from the Data Health tab.
        </p>
      ) : (
        <>
          <StatStrip
            projectId={project.id}
            driftDays={forecast?.project.driftDays ?? 0}
            atRiskCount={atRiskCount}
            percentComplete={health.hasImport ? health.progress.percentComplete : 0}
            lastUpdate={lastUpdate}
          />
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              {project.client && <span className="rounded bg-slate-200 px-2 py-1">{project.client}</span>}
              {project.sector && <span className="rounded bg-slate-200 px-2 py-1">{project.sector}</span>}
              {project.sizeSqFt && <span className="rounded bg-slate-200 px-2 py-1">{project.sizeSqFt.toLocaleString()} sf</span>}
            </div>
            <div className="flex items-center gap-2">
              <ExportMenu projectId={project.id} />
              <form action={appPath("/api/updates")} method="post">
                <input type="hidden" name="projectId" value={project.id} />
                <button className="rounded-lg bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-800">
                  Update progress
                </button>
              </form>
            </div>
          </div>
          {riskFetchedAt && (
            <p className="mb-2 text-xs text-slate-500">
              Procurement risk as of {riskFetchedAt.toISOString().slice(0, 16).replace("T", " ")}
            </p>
          )}
          <ActivityTable rows={rows} />
        </>
      )}
    </main>
  );
```

Removed on purpose: the six-button row, the duplicate `<h1>` (the layout header already names the project), the import metadata card (now on Data Health), the health summary strip (StatStrip's % stat links to `/health`), and the admin reset footer (now on Data Health). The "Update progress" form POSTs with only `projectId` — `/api/updates` defaults `asOfDate` to today and `lookaheadWeeks` to 3, then 303-redirects into the project's single draft (`getOrCreateDraft` reuses an existing draft, so repeat clicks land in the same one).

- [ ] **Step 2: Full verification**

Run: `npm run build && npm test`
Expected: build clean, full suite green (Tasks 1–3 suites included).

- [ ] **Step 3: Smoke-check the routes**

Run: `npm run dev` in the background, then `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/projects/x/normalize` — expect a redirect status pointing at `/projects/x/data` (or the login redirect if auth intercepts first; either proves routing). Stop the dev server afterwards.

- [ ] **Step 4: Commit**

```bash
git add app/projects/[id]/page.tsx
git commit -m "feat(shell): schedule tab with stat strip and direct update/export actions"
```

---

## Not in this phase (deliberate)

- View switcher (`Full · 6 wk · 3 wk`), timeline body, mobile buckets — phase 3 (the `ActivityTable` body is intentionally untouched).
- Drift / at-risk stat links — wired in phase 3 when the body accepts sort/filter params.
- Lookahead PDF menu items — phase 4.
- `/updates` page keeps its as-of/lookahead form as a secondary path; the primary path is the Update progress button.
- Old-route redirects don't carry `?wizard=1` — the wizard now starts only from a fresh first import.
