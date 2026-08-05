import { prisma } from "@/lib/db";
import { getScheduleHealth } from "@/lib/health/healthService";
import { getScheduleData } from "@/lib/schedule/scheduleRows";
import { buildLookaheadView, type LookaheadView, type LookaheadWeeks } from "./lookaheadView";

export type PageSize = "tabloid" | "letter";
export interface LookaheadPayload {
  view: LookaheadView;
  projectName: string;
}

export function parseWeeks(raw: string | undefined): LookaheadWeeks {
  return raw === "6" ? 6 : 3;
}

export function parseSize(raw: string | undefined): PageSize {
  return raw === "letter" ? "letter" : "tabloid";
}

/** The one server-side load behind both the screen route and the PDF endpoint. */
export async function getLookahead(
  projectId: string,
  weeks: LookaheadWeeks,
  today: Date,
): Promise<LookaheadPayload | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) return null;
  const schedule = await getScheduleData(projectId);
  if (!schedule) return null;

  const health = await getScheduleHealth(projectId);
  const lastFinalized = await prisma.progressUpdate.findFirst({
    where: { projectId, state: "finalized" },
    orderBy: { asOfDate: "desc" },
    select: { asOfDate: true },
  });

  return {
    projectName: project.name,
    view: buildLookaheadView({
      rows: schedule.rows,
      projectDriftDays: schedule.projectDriftDays,
      statusDate: schedule.statusDate,
      percentComplete: health.hasImport ? health.progress.percentComplete : 0,
      lastUpdateDaysAgo: lastFinalized
        ? Math.max(0, Math.floor((today.getTime() - lastFinalized.asOfDate.getTime()) / 86_400_000))
        : null,
      weeks,
      today,
    }),
  };
}
