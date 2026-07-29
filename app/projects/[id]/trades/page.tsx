import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/normalize/normalizationService";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { suggestScopes } from "@/lib/normalize/suggestScopes";
import {
  getTradeDictionary,
  getProjectDisciplines,
  getPartnersForDiscipline,
  getProjectAssignments,
  getDismissedScopes,
} from "@/lib/trades/tradesService";
import { applyTradeDictionaryWith } from "@/lib/trades/applyTradeDictionary";
import { getTradeDrift } from "@/lib/trades/tradeDrift";
import { TradesPanel, type DisciplineRow, type AssignmentRow } from "@/components/TradesPanel";

export const dynamic = "force-dynamic";

export default async function TradesPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const latest = await prisma.scheduleImport.findFirst({ where: { projectId: project.id }, orderBy: { importedAt: "desc" }, include: { activities: true } });
  const leaves = (latest?.activities ?? []).filter((a) => a.type !== "summary" && a.type !== "project_summary");

  const scopeDict = await getDictionary();
  const scopesPresent = new Set<string>();
  let unnormalizedCount = 0;
  for (const a of leaves) {
    const scope = scopeDict.get(normalizeName(a.name));
    if (scope) scopesPresent.add(scope);
    else unnormalizedCount++;
  }

  const tradeDict = await getTradeDictionary();
  const { mapped, unmappedScopes } = applyTradeDictionaryWith([...scopesPresent], tradeDict);
  const disciplines = await getProjectDisciplines(project.id);
  const assignments = await getProjectAssignments(project.id);
  const dismissedScopes = await getDismissedScopes(project.id);
  const driftRows = await getTradeDrift(project.id);

  const dismissed = new Set(dismissedScopes);
  const reviewScopes = unmappedScopes.filter((scope) => !dismissed.has(scope));

  // suggestScopes ranks by token overlap, so it needs names; map the winners
  // back to the OS disciplines they came from.
  const byName = new Map(disciplines.map((d) => [d.name, d]));
  const disciplineRows: DisciplineRow[] = reviewScopes.map((scope) => ({
    canonicalScope: scope,
    suggestions: suggestScopes(scope, [...byName.keys()])
      .map((name) => byName.get(name))
      .filter((d): d is NonNullable<typeof d> => Boolean(d)),
  }));

  // Only disciplines this schedule actually contains get an assignment row.
  const presentIds = [...new Map(mapped.map((m) => [m.discipline.id, m.discipline])).values()]
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

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Trades</h1>
      <p className="mb-4 text-sm text-slate-500">
        {mapped.length} scopes mapped to a discipline · {disciplineRows.length} to review
        {unnormalizedCount > 0 ? ` · ${unnormalizedCount} activities need normalizing first` : ""}
      </p>
      {!latest ? (
        <p className="text-slate-500">Import a schedule first.</p>
      ) : (
        <TradesPanel
          projectId={project.id}
          disciplineRows={disciplineRows}
          assignmentRows={assignmentRows}
          disciplines={disciplines}
          dismissedScopes={dismissedScopes}
          driftRows={driftRows}
        />
      )}
    </main>
  );
}
