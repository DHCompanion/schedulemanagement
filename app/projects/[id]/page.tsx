import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ScheduleBody } from "@/components/ScheduleBody";
import { getScheduleHealth } from "@/lib/health/healthService";
import { appPath } from "@/lib/http";
import { getScheduleData } from "@/lib/schedule/scheduleRows";
import { getDataHealthCounts } from "@/lib/health/dataHealthCounts";
import { ProjectTabs } from "@/components/ProjectTabs";
import { StatStrip } from "@/components/StatStrip";
import { ExportMenu } from "@/components/ExportMenu";

export const dynamic = "force-dynamic";

export default async function ProjectPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; filter?: string; sort?: string }>;
}) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const schedule = await getScheduleData(project.id);
  const health = await getScheduleHealth(project.id);
  const dataCounts = await getDataHealthCounts(project.id);
  const lastFinalized = await prisma.progressUpdate.findFirst({
    where: { projectId: project.id, state: "finalized" },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });
  const lastUpdate = lastFinalized
    ? { daysAgo: Math.max(0, Math.floor((Date.now() - lastFinalized.asOfDate.getTime()) / 86_400_000)) }
    : null;

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <ProjectTabs projectId={project.id} active="schedule" dataBadge={dataCounts.total} />

      {!schedule ? (
        <p className="text-slate-500">
          No schedule imported yet — import one from the Data Health tab.
        </p>
      ) : (
        <>
          <StatStrip
            projectId={project.id}
            driftDays={schedule.projectDriftDays}
            atRiskCount={schedule.atRiskCount}
            percentComplete={health.hasImport ? health.progress.percentComplete : 0}
            lastUpdate={lastUpdate}
          />
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              {project.client && <span className="rounded bg-slate-200 px-2 py-1">{project.client}</span>}
              {project.sector && <span className="rounded bg-slate-200 px-2 py-1">{project.sector}</span>}
              {project.sizeSqFt && <span className="rounded bg-slate-200 px-2 py-1">{project.sizeSqFt.toLocaleString()} sf</span>}
            </div>
            <div className="flex items-center gap-2">
              <ExportMenu projectId={project.id} />
              <form action={appPath("/api/updates")} method="post">
                <input type="hidden" name="projectId" value={project.id} />
                <button className="rounded-lg bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-800">
                  Update progress
                </button>
              </form>
            </div>
          </div>
          {schedule.riskFetchedAt && (
            <p className="mb-2 text-xs text-slate-500">
              Procurement risk as of {schedule.riskFetchedAt.toISOString().slice(0, 16).replace("T", " ")}
            </p>
          )}
          <ScheduleBody
            rows={schedule.rows}
            projectId={project.id}
            statusDate={schedule.statusDate}
            view={searchParams.view === "6wk" || searchParams.view === "3wk" ? searchParams.view : "full"}
            initialFilter={searchParams.filter ?? null}
            initialSort={searchParams.sort ?? null}
          />
        </>
      )}
    </main>
  );
}
