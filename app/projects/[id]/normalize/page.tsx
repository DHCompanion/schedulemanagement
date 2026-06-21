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
