import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ActivityTable, type ActivityRow } from "@/components/ActivityTable";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { getScheduleHealth } from "@/lib/health/healthService";
import { getDictionary } from "@/lib/normalize/normalizationService";
import { normalizeName } from "@/lib/normalize/normalizeName";
import {
  isActivityAtRisk,
  resolveActivityTrades,
  shouldShowProcurementRiskLine,
} from "@/lib/trades/activityTrades";
import { appPath } from "@/lib/http";
import { getProjectForecast } from "@/lib/forecast/getProjectForecast";
import { getDataHealthCounts } from "@/lib/health/dataHealthCounts";
import { ProjectTabs } from "@/components/ProjectTabs";
import { StatStrip } from "@/components/StatStrip";
import { ExportMenu } from "@/components/ExportMenu";

export const dynamic = "force-dynamic";

function toDays(minutes: number | null, minutesPerDay: number | null): number | null {
  if (minutes === null || !minutesPerDay) return null;
  return minutes / minutesPerDay;
}

export default async function ProjectPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
  // The standard names confirmed in the Task Naming step are what this table
  // shows; the schedule's own wording stays visible underneath so the row is
  // still findable by what MS Project calls it.
  const scopeDict = await getDictionary();
  const trades = await resolveActivityTrades(
    project.id,
    (latest?.activities ?? []).map((a) => ({ id: a.id, name: a.name })),
  );
  // One query serves the pill, the freshness line and the detail panel. Rows
  // exist for every partner procurement returned, flagged or not, so their
  // presence is what distinguishes "checked, nothing flagged" from "never
  // checked". earliestRequiredOnSite is deliberately not selected: it is
  // partner-wide and would invite an invalid comparison against one activity's
  // own start date.
  const procurementRisk = await prisma.osProcurementRisk.findMany({
    where: { projectId: project.id },
    select: {
      osPartnerId: true,
      itemCount: true,
      behindCount: true,
      submittalLateCount: true,
      projectedLateCount: true,
      releasedAtRiskCount: true,
      missingDatesCount: true,
      fetchedAt: true,
    },
  });
  // "Behind" is procurement's own verdict: a submittal past its start-by date, or
  // a projection landing after the material is required.
  const flaggedPartners = new Set(
    procurementRisk.filter((r) => r.behindCount > 0).map((r) => r.osPartnerId),
  );
  const procurementByPartner = new Map(
    procurementRisk.map((r) => [
      r.osPartnerId,
      {
        itemCount: r.itemCount,
        behindCount: r.behindCount,
        submittalLateCount: r.submittalLateCount,
        projectedLateCount: r.projectedLateCount,
        releasedAtRiskCount: r.releasedAtRiskCount,
        missingDatesCount: r.missingDatesCount,
      },
    ]),
  );
  // The line must not claim "checked" when nothing could actually resolve to a
  // partner — see shouldShowProcurementRiskLine.
  const riskFetchedAt = shouldShowProcurementRiskLine(procurementRisk.length > 0, trades.values())
    ? procurementRisk[0]?.fetchedAt ?? null
    : null;
  const rows: ActivityRow[] = (latest?.activities ?? []).map((a) => {
    const percentComplete =
      currentProgress.get(a.canonicalActivityKey)?.percentComplete ?? a.percentComplete;
    const partnerId = trades.get(a.id)?.osPartnerId ?? null;
    return {
      id: a.id,
      externalId: a.externalId,
      wbsCode: a.wbsCode,
      name: a.name,
      canonicalScope: scopeDict.get(normalizeName(a.name)) ?? null,
      disciplineName: trades.get(a.id)?.disciplineName ?? null,
      partnerName: trades.get(a.id)?.partnerName ?? null,
      atRisk: isActivityAtRisk(partnerId, percentComplete, flaggedPartners),
      procurement: partnerId === null ? null : procurementByPartner.get(partnerId) ?? null,
      type: a.type,
      isCritical: a.isCritical,
      outlineLevel: a.outlineLevel,
      plannedStart: a.plannedStart ? a.plannedStart.toISOString() : null,
      plannedFinish: a.plannedFinish ? a.plannedFinish.toISOString() : null,
      percentComplete,
      totalSlackDays: toDays(a.totalSlackMinutes, mpd),
      durationDays: a.durationDays,
      customFields: (a.customFields as Record<string, string>) ?? {},
    };
  });

  const forecast = await getProjectForecast(project.id);
  const dataCounts = await getDataHealthCounts(project.id);
  const lastFinalized = await prisma.progressUpdate.findFirst({
    where: { projectId: project.id, state: "finalized" },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });
  const lastUpdate = lastFinalized
    ? { daysAgo: Math.max(0, Math.floor((Date.now() - lastFinalized.asOfDate.getTime()) / 86_400_000)) }
    : null;
  const atRiskCount = rows.filter((r) => r.atRisk).length;

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <ProjectTabs projectId={project.id} active="schedule" dataBadge={dataCounts.total} />

      {!latest ? (
        <p className="text-slate-500">
          No schedule imported yet — import one from the Data Health tab.
        </p>
      ) : (
        <>
          <StatStrip
            projectId={project.id}
            driftDays={forecast?.project.driftDays ?? 0}
            atRiskCount={atRiskCount}
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
          {riskFetchedAt && (
            <p className="mb-2 text-xs text-slate-500">
              Procurement risk as of {riskFetchedAt.toISOString().slice(0, 16).replace("T", " ")}
            </p>
          )}
          <ActivityTable rows={rows} />
        </>
      )}
    </main>
  );
}
