import { prisma } from "@/lib/db";

/** A possible data date, and when someone last said so. */
export interface DataDateCandidate {
  date: Date | null | undefined;
  setAt: Date | null | undefined;
}

/** The most recently set candidate wins; candidates missing either half are ignored. */
export function pickDataDate(candidates: DataDateCandidate[]): Date | null {
  let best: { date: Date; setAt: Date } | null = null;
  for (const c of candidates) {
    if (!c.date || !c.setAt) continue;
    if (!best || c.setAt > best.setAt) best = { date: c.date, setAt: c.setAt };
  }
  return best?.date ?? null;
}

/**
 * The one data-date resolution used everywhere a forecast runs (schedule body,
 * buckets, OS context packet). Three things can state a data date — an import's
 * status date, a finalized progress update's as-of date, and a date set by hand
 * on the schedule screen — and whichever was stated most recently wins.
 *
 * This used to prefer a finalized update unconditionally, so a months-old
 * update kept overriding the status date of every later import.
 *
 * The import's claim is dated by the latest REAL import: accepting a split
 * mints a synthetic import stamped "now" that merely copies the status date
 * forward, and must not outrank a date set by hand in the meantime.
 */
export async function resolveForecastStatusDate(
  projectId: string,
  imp: { statusDate: Date | null; importedAt: Date },
): Promise<Date> {
  const [latestUpdate, realImport, project] = await Promise.all([
    prisma.progressUpdate.findFirst({
      where: { projectId, state: "finalized" },
      orderBy: { asOfDate: "desc" },
      select: { asOfDate: true, finalizedAt: true, updatedAt: true },
    }),
    prisma.scheduleImport.findFirst({
      where: { projectId, isSynthetic: false },
      orderBy: { importedAt: "desc" },
      select: { statusDate: true, importedAt: true },
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { dataDateOverride: true, dataDateOverrideAt: true },
    }),
  ]);
  return (
    pickDataDate([
      { date: project?.dataDateOverride, setAt: project?.dataDateOverrideAt },
      { date: latestUpdate?.asOfDate, setAt: latestUpdate?.finalizedAt ?? latestUpdate?.updatedAt },
      { date: realImport?.statusDate, setAt: realImport?.importedAt },
    ]) ??
    imp.statusDate ??
    imp.importedAt
  );
}
