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
