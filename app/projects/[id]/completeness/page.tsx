import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCompleteness } from "@/lib/completeness/completenessService";
import { CompletenessIssuesTable } from "@/components/CompletenessIssuesTable";
import { WizardBanner } from "@/components/WizardBanner";

export const dynamic = "force-dynamic";

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
        </>
      )}
    </main>
  );
}
