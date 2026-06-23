import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ActivityTable, type ActivityRow } from "@/components/ActivityTable";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { getScheduleHealth } from "@/lib/health/healthService";

export const dynamic = "force-dynamic";

function toDays(minutes: number | null, minutesPerDay: number | null): number | null {
  if (minutes === null || !minutesPerDay) return null;
  return minutes / minutesPerDay;
}

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId: project.id },
    orderBy: { importedAt: "desc" },
    include: { activities: { orderBy: { wbsCode: "asc" } } },
  });

  const currentProgress = resolveCurrentProgress(await getFinalizedEntries(project.id));
  const health = await getScheduleHealth(project.id);
  const mpd = latest?.minutesPerDay ?? 480;
  const rows: ActivityRow[] = (latest?.activities ?? []).map((a) => ({
    id: a.id,
    externalId: a.externalId,
    wbsCode: a.wbsCode,
    name: a.name,
    type: a.type,
    isCritical: a.isCritical,
    outlineLevel: a.outlineLevel,
    plannedStart: a.plannedStart ? a.plannedStart.toISOString() : null,
    plannedFinish: a.plannedFinish ? a.plannedFinish.toISOString() : null,
    percentComplete: currentProgress.get(a.canonicalActivityKey)?.percentComplete ?? a.percentComplete,
    totalSlackDays: toDays(a.totalSlackMinutes, mpd),
    durationDays: a.durationDays,
    customFields: (a.customFields as Record<string, string>) ?? {},
  }));

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link href="/" className="text-sm text-slate-500">← Projects</Link>
      <div className="mb-4 mt-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{project.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/projects/${project.id}/normalize`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Task Naming
          </Link>
          <Link href={`/projects/${project.id}/completeness`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Task Granularity
          </Link>
          <Link href={`/projects/${project.id}/trades`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Trades
          </Link>
          <Link href={`/projects/${project.id}/updates`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Progress Update
          </Link>
          <Link href={`/projects/${project.id}/export`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Export to MS Project
          </Link>
          <Link href={`/projects/${project.id}/import`} className="rounded-lg bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-800">
            Import Schedule
          </Link>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-xs text-slate-600">
        {project.client && <span className="rounded bg-slate-200 px-2 py-1">{project.client}</span>}
        {project.sector && <span className="rounded bg-slate-200 px-2 py-1">{project.sector}</span>}
        {project.sizeSqFt && <span className="rounded bg-slate-200 px-2 py-1">{project.sizeSqFt.toLocaleString()} sf</span>}
      </div>

      {!latest ? (
        <p className="text-slate-500">No schedule imported yet.</p>
      ) : (
        <>
          <div className={`rounded border border-slate-200 bg-white p-3 text-sm text-slate-600 ${health.hasImport ? "border-b-0" : "mb-4"}`}>
            <div>File: {latest.fileName}</div>
            <div>Imported: {latest.importedAt.toISOString().slice(0, 16).replace("T", " ")}</div>
            <div>Status date: {latest.statusDate ? latest.statusDate.toISOString().slice(0, 10) : "—"}</div>
            <div>{latest.isBaseline ? "Baseline import" : "Update import"} · {latest.activityCount} activities · {latest.relationshipCount} relationships</div>
          </div>
          {health.hasImport && (
            <Link
              href={`/projects/${project.id}/health`}
              className="mb-4 flex flex-wrap gap-4 rounded border border-t-0 border-slate-200 bg-white p-3 text-sm text-slate-600 hover:bg-slate-50"
            >
              <div><span className="font-medium">{health.progress.total}</span> total</div>
              <div><span className="font-medium">{health.progress.completed}</span> completed</div>
              <div><span className="font-medium">{health.progress.remaining}</span> remaining</div>
              <div><span className="font-medium">{health.progress.percentComplete}%</span> complete</div>
            </Link>
          )}
          <ActivityTable rows={rows} />
        </>
      )}
    </main>
  );
}
