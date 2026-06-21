import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getScheduleHealth } from "@/lib/health/healthService";
import { HealthCheckSection } from "@/components/HealthCheckSection";
import { WizardBanner } from "@/components/WizardBanner";
import type { HealthCheck } from "@/lib/health/dateChecks";

export const dynamic = "force-dynamic";

const SECTIONS: { check: HealthCheck; title: string }[] = [
  { check: "out_of_envelope", title: "Out-of-envelope dates" },
  { check: "future_actual", title: "Future actuals" },
  { check: "missing_dates", title: "Missing dates" },
  { check: "percent_contradiction", title: "Percent contradictions" },
];

export default async function HealthPage({ params, searchParams }: { params: { id: string }; searchParams: { wizard?: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const health = await getScheduleHealth(project.id);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Schedule health</h1>
      {searchParams.wizard === "1" && (
        <WizardBanner
          projectId={project.id}
          step={0}
          why="Catch bad or implausible dates before anything else, since a bad date can throw off everything downstream."
        />
      )}
      {!health.hasImport ? (
        <p className="text-slate-500">Import a schedule first.</p>
      ) : (
        <>
          {health.asOfDate && <p className="mb-4 text-sm text-slate-500">Data date {health.asOfDate.toISOString().slice(0, 10)}</p>}
          <section className="mb-6 rounded border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Progress</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              <div><span className="font-medium">{health.progress.total}</span> total</div>
              <div><span className="font-medium">{health.progress.completed}</span> completed</div>
              <div><span className="font-medium">{health.progress.remaining}</span> remaining</div>
              <div><span className="font-medium">{health.progress.percentComplete}%</span> complete</div>
            </div>
          </section>
          {SECTIONS.map(({ check, title }) => (
            <HealthCheckSection key={check} title={title} issues={health.issues.filter((i) => i.check === check)} />
          ))}
        </>
      )}
    </main>
  );
}
