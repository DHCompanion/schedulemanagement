import { prisma } from "@/lib/db";
import { resolveActivityTrades, type ActivityTrade } from "@/lib/trades/activityTrades";
import { getProjectDisciplines } from "@/lib/trades/tradesService";
import { isLeafActive } from "@/lib/completeness/completenessService";

// The alias the export writes and the importer reads back. Renaming it breaks
// the round-trip silently — the column simply stops being found.
export const TRADE_PARTNER_ALIAS = "Trade Partner";

export interface TradeDriftRow {
  osDisciplineId: number;
  disciplineName: string;
  fileValue: string;
  toolValue: string | null;
  activityCount: number;
}

export interface ActivityWithFields {
  id: string;
  customFields: Record<string, string>;
}

export const dismissalKey = (osDisciplineId: number, fileValue: string) => `${osDisciplineId}::${fileValue}`;

/**
 * Where a re-imported file names a different trade partner than this project
 * has assigned.
 *
 * One row per (discipline, distinct file value): if a file names two different
 * partners on two activities of one discipline, that is two decisions, and
 * collapsing them would force one answer onto both and hide the second.
 *
 * Compared against the freshly derived assignment rather than a snapshot taken
 * at export time. A snapshot would separate "edited in MS Project" from
 * "reassigned here since exporting", at the cost of a table and a write on every
 * export — and both cases want review anyway.
 */
export function findTradeDrift(
  activities: ActivityWithFields[],
  trades: Map<string, ActivityTrade>,
  disciplineIdByName: Map<string, number>,
  dismissed: Set<string>,
): TradeDriftRow[] {
  const byKey = new Map<string, TradeDriftRow>();

  for (const activity of activities) {
    const fileValue = activity.customFields?.[TRADE_PARTNER_ALIAS];
    if (!fileValue) continue;

    const trade = trades.get(activity.id);
    if (!trade) continue;
    if (trade.partnerName === fileValue) continue;

    const osDisciplineId = disciplineIdByName.get(trade.disciplineName);
    if (osDisciplineId === undefined) continue;

    const key = dismissalKey(osDisciplineId, fileValue);
    if (dismissed.has(key)) continue;

    const existing = byKey.get(key);
    if (existing) {
      existing.activityCount += 1;
    } else {
      byKey.set(key, {
        osDisciplineId,
        disciplineName: trade.disciplineName,
        fileValue,
        toolValue: trade.partnerName,
        activityCount: 1,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => a.disciplineName.localeCompare(b.disciplineName));
}

export async function getTradeDrift(projectId: string): Promise<TradeDriftRow[]> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  if (!latest) return [];

  const leaves = latest.activities.filter(isLeafActive);
  const [trades, disciplines, dismissals] = await Promise.all([
    resolveActivityTrades(projectId, leaves.map((a) => ({ id: a.id, name: a.name }))),
    getProjectDisciplines(projectId),
    prisma.tradeDriftDismissal.findMany({ where: { projectId } }),
  ]);

  return findTradeDrift(
    leaves.map((a) => ({ id: a.id, customFields: (a.customFields as Record<string, string>) ?? {} })),
    trades,
    new Map(disciplines.map((d) => [d.name, d.id])),
    new Set(dismissals.map((d) => dismissalKey(d.osDisciplineId, d.fileValue))),
  );
}
