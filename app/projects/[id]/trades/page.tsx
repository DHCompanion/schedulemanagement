import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDictionary } from "@/lib/normalize/normalizationService";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { suggestScopes } from "@/lib/normalize/suggestScopes";
import { getTradeDictionary, getKnownDisciplines, getTradePartners, getProjectAssignments } from "@/lib/trades/tradesService";
import { applyTradeDictionaryWith } from "@/lib/trades/applyTradeDictionary";
import { TradesPanel, type DisciplineRow, type AssignmentRow } from "@/components/TradesPanel";

export const dynamic = "force-dynamic";

export default async function TradesPage({ params }: { params: { id: string } }) {
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
  const knownDisciplines = await getKnownDisciplines();
  const partners = await getTradePartners();
  const assignments = await getProjectAssignments(project.id);

  const disciplineRows: DisciplineRow[] = unmappedScopes.map((scope) => ({ canonicalScope: scope, suggestions: suggestScopes(scope, knownDisciplines) }));
  const disciplinesPresent = [...new Set(mapped.map((m) => m.discipline))].sort();
  const assignmentRows: AssignmentRow[] = disciplinesPresent.map((discipline) => ({ discipline, currentCompany: assignments.get(discipline) ?? "" }));

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
        <TradesPanel projectId={project.id} disciplineRows={disciplineRows} assignmentRows={assignmentRows} knownDisciplines={knownDisciplines} partners={partners} />
      )}
    </main>
  );
}
