import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getScheduleHealth } from "@/lib/health/healthService";
import { HealthIssuesTable } from "@/components/HealthIssuesTable";

export const dynamic = "force-dynamic";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default async function HealthPage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const health = await getScheduleHealth(project.id);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Schedule health</h1>
      {!health.hasImport ? (
        <p className="text-slate-500">Import a schedule first.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-500">
            {plural(health.summary.errors, "error")} · {plural(health.summary.warnings, "warning")}
            {health.asOfDate && <> · data date {health.asOfDate.toISOString().slice(0, 10)}</>}
          </p>
          {health.issues.length === 0 ? (
            <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">No date issues found.</p>
          ) : (
            <HealthIssuesTable issues={health.issues} />
          )}
        </>
      )}
    </main>
  );
}
