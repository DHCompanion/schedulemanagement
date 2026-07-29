import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getCompleteness } from "@/lib/completeness/completenessService";
import { getSplitRules } from "@/lib/completeness/splitRuleService";
import { ADMIN_SESSION_COOKIE } from "@/lib/auth";
import { SCOPE_COOKIE, isAdminFromCookies } from "@/lib/scope";
import { CompletenessIssuesTable } from "@/components/CompletenessIssuesTable";
import { CoarsePanel } from "@/components/CoarsePanel";
import { SplitRulesPanel, type SplitRuleRow } from "@/components/SplitRulesPanel";
import { WizardBanner } from "@/components/WizardBanner";

export const dynamic = "force-dynamic";

export default async function CompletenessPage({ params, searchParams }: { params: { id: string }; searchParams: { wizard?: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const completeness = await getCompleteness(project.id);
  const splitRulesMap = await getSplitRules();
  const splitRules: SplitRuleRow[] = [...splitRulesMap.entries()].map(([coarseScope, finerScopes]) => ({ coarseScope, finerScopes }));
  const jar = cookies();
  const adminSession = await isAdminFromCookies(
    jar.get(ADMIN_SESSION_COOKIE)?.value,
    jar.get(SCOPE_COOKIE)?.value,
    Math.floor(Date.now() / 1000)
  );

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Task Granularity</h1>
      {searchParams.wizard === "1" && (
        <WizardBanner
          projectId={project.id}
          step={1}
          why="Flag any activity that lumps too much work together, before naming — a scope you are going to split is not worth naming twice."
        />
      )}
      {!completeness.hasImport ? (
        <p className="text-slate-500">Import a schedule first.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-500">{completeness.summary.total} activities flagged as too coarse</p>
          {completeness.issues.length === 0 ? (
            <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              No coarse activities flagged.
            </p>
          ) : (
            <CompletenessIssuesTable projectId={project.id} issues={completeness.issues} />
          )}
          <div className="mt-8">
            <CoarsePanel rows={completeness.names} isAdmin={adminSession} />
          </div>
        </>
      )}
      <div className="mt-8">
        <SplitRulesPanel rules={splitRules} isAdmin={adminSession} />
      </div>
    </main>
  );
}
