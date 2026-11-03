import type { Prisma } from "@prisma/client";

type Dated = { key: string; actualStart: string | null; actualFinish: string | null };
const day = (d: Date) => d.toISOString().slice(0, 10);

/** YYYY-MM-DD as UTC midnight, or null if it is not a real calendar date. */
export function parseDay(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && day(d) === s ? d : null;
}

/** Why a draft can't be "as of" target (YYYY-MM-DD), or null. One rule for people and agents: the date is after the
 * project's last finalized update, and no progress in the draft is recorded after it. */
export async function dataDateProblem(tx: Prisma.TransactionClient, projectId: string, target: string, entries: Dated[]):
  Promise<{ message: string; keys: string[] } | null> {
  const finalized = await tx.progressUpdate.findFirst({ where: { projectId, state: "finalized" }, orderBy: { asOfDate: "desc" }, select: { asOfDate: true } });
  if (finalized && target <= day(finalized.asOfDate))
    return { message: `The data date must be after the last finalized update (${day(finalized.asOfDate)}).`, keys: [] };
  const late = entries.filter((e) => [e.actualStart, e.actualFinish].some((d) => d && d > target)).map((e) => e.key);
  return late.length ? { message: `Actual dates can't be after the data date ${target}. Change those dates or the data date.`, keys: late } : null;
}
