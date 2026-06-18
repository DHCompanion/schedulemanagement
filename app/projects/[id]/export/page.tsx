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
