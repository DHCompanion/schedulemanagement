import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getScheduleHealth } from "@/lib/health/healthService";
import { HealthCheckSection } from "@/components/HealthCheckSection";
import type { HealthCheck } from "@/lib/health/dateChecks";
import type { LogicMetricKey } from "@/lib/health/logicChecks";
import { TierBadge } from "@/components/TierBadge";

export const dynamic = "force-dynamic";

const SECTIONS: { check: HealthCheck; title: string }[] = [
  { check: "out_of_envelope", title: "Out-of-envelope dates" },
  { check: "future_actual", title: "Future actuals" },
  { check: "missing_dates", title: "Missing dates" },
  { check: "percent_contradiction", title: "Percent contradictions" },
];

const METRIC_LABELS: Record<LogicMetricKey, string> = {
  missing_logic: "Missing logic",
  leads: "Leads (negative lag)",
  lags: "Lags",
  non_fs: "Non finish-to-start links",
  hard_constraints: "Hard constraints",
  high_float: "High float (> 44 days)",
  negative_float: "Negative float",
  high_duration: "Long durations (> 44 days, lead times excluded)",
  out_of_sequence: "Out-of-sequence progress",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default async function HealthPage(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ wizard?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const health = await getScheduleHealth(project.id);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-1 mt-1 text-xl font-semibold">Schedule Health</h1>
      {searchParams.wizard === "1" && !project.onboardingCompletedAt && (
        <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm">
          <div className="mb-1 font-medium text-blue-900">First-time setup — step 1 of 2: Schedule Health</div>
          <p className="mb-2 text-blue-800">
            Check the imported dates look sane before cleaning anything — bad dates here mean a
            bad schedule everywhere else in this tool.
          </p>
          <Link href={`/projects/${project.id}/data?wizard=1`} className="inline-block rounded bg-blue-900 px-3 py-1.5 text-xs font-medium text-white">
            Next: Data Health
          </Link>
        </div>
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
          {health.quality && (
            <section className="mb-6 rounded border border-slate-200 bg-white p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-700">Schedule logic</h2>
                <TierBadge tier={health.quality.tier} />
                <span className="text-xs text-slate-500">
                  {health.quality.logic.passed} of {health.quality.logic.total} checks pass
                </span>
              </div>
              <ul className="mb-2 text-xs text-slate-600">
                {health.quality.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
              {health.quality.logic.metrics.some((m) => !m.pass) && (
                <ul className="divide-y divide-slate-200 rounded border border-slate-200 text-sm">
                  {health.quality.logic.metrics.filter((m) => !m.pass).map((m) => (
                    <li key={m.key} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                      <span>{METRIC_LABELS[m.key]}</span>
                      <span className="text-slate-600">{pct(m.pct)} (limit {pct(m.threshold)})</span>
                    </li>
                  ))}
                </ul>
              )}
              {!health.quality.logic.benchmarkEligible && (
                <p className="mt-2 text-xs text-slate-500">
                  This schedule won&apos;t feed historical durations or sequencing — only its activity names and breakdowns.
                </p>
              )}
            </section>
          )}
          {SECTIONS.map(({ check, title }) => (
            <HealthCheckSection key={check} title={title} issues={health.issues.filter((i) => i.check === check)} />
          ))}
        </>
      )}
    </main>
  );
}
