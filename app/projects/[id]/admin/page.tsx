import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isAdminSession } from "@/lib/adminSession";
import { applyDictionary } from "@/lib/normalize/normalizationService";
import { getCompleteness } from "@/lib/completeness/completenessService";
import { getNotCoarseNames, getSplitRules } from "@/lib/completeness/splitRuleService";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { getDataHealthCounts } from "@/lib/health/dataHealthCounts";
import { DictionaryPanel, type MappedRow } from "@/components/DictionaryPanel";
import { CoarsePanel } from "@/components/CoarsePanel";
import { SplitRulesPanel, type SplitRuleRow } from "@/components/SplitRulesPanel";
import { ProjectTabs } from "@/components/ProjectTabs";
import { ResetProjectButton } from "@/components/ResetProjectButton";

export const dynamic = "force-dynamic";

// Everything here either edits a dictionary shared by every project or wipes
// this one's schedule data, so it lives apart from the Data Health review flow
// and the page itself — not just its tab — refuses non-admins. The API routes
// behind these panels check admin again on their own.
export default async function AdminPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!(await isAdminSession())) notFound();
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId: project.id },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  const leaves = (latest?.activities ?? []).filter((a) => a.type !== "summary" && a.type !== "project_summary");

  const { mapped } = await applyDictionary(leaves);
  const nameCounts = new Map<string, number>();
  for (const a of leaves) {
    const key = a.name.trim();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const mappedRows: MappedRow[] = [
    ...new Map(
      mapped.map(({ activity, canonicalScope }) => {
        const rawName = activity.name.trim();
        return [rawName, { rawName, canonicalScope, count: nameCounts.get(rawName) ?? 1 }] as const;
      })
    ).values(),
  ].sort((a, b) => a.canonicalScope.localeCompare(b.canonicalScope));

  const completeness = await getCompleteness(project.id);
  // Merged here rather than inside getCompleteness: that read also backs Data
  // Health and split acceptance, which have no use for the reviewed marks.
  const notCoarse = await getNotCoarseNames();
  const coarseRows = completeness.names.map((n) => ({ ...n, notCoarse: notCoarse.has(normalizeName(n.name)) }));
  const splitRules: SplitRuleRow[] = [...(await getSplitRules()).entries()].map(([coarseScope, finerScopes]) => ({ coarseScope, finerScopes }));
  const dataCounts = await getDataHealthCounts(project.id);

  return (
    <main className="mx-auto max-w-screen-2xl p-4 sm:p-6">
      <ProjectTabs projectId={project.id} active="admin" dataBadge={dataCounts.total} isAdmin />

      <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Split rules and name mappings are shared by every project — a change here changes them all.
      </p>

      <div className="space-y-4">
        <div className="rounded border border-slate-200 bg-white p-4">
          <h1 className="mb-3 font-medium">Task Granularity rules</h1>
          {completeness.hasImport && <CoarsePanel rows={coarseRows} isAdmin />}
          <div className="mt-6">
            <SplitRulesPanel rules={splitRules} isAdmin />
          </div>
        </div>

        <div className="rounded border border-slate-200 bg-white p-4">
          <h1 className="mb-3 font-medium">Task Naming dictionary</h1>
          <DictionaryPanel rows={mappedRows} isAdmin />
        </div>

        <div className="rounded border border-red-200 bg-white p-4">
          <h1 className="mb-3 font-medium">Reset</h1>
          <ResetProjectButton projectId={project.id} projectName={project.name} />
        </div>
      </div>
    </main>
  );
}
