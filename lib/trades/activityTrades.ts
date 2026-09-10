import { normalizeName } from "@/lib/normalize/normalizeName";
import { getDictionary } from "@/lib/normalize/normalizationService";
import {
  getProjectAssignments,
  getTradeDictionary,
  type OsDiscipline,
  type ProjectAssignment,
} from "@/lib/trades/tradesService";

export type ActivityTrade = {
  disciplineName: string;
  partnerName: string | null;
  /** The OS trade partner id — the join key to any OS-sourced partner data. */
  osPartnerId: number | null;
};

export interface NamedActivity {
  id: string;
  name: string;
}

/**
 * Who is doing this activity, derived rather than stored:
 *   name -> canonical scope -> OS discipline -> the partner assigned to it.
 *
 * An activity missing from the result is a normal state, not an error — its
 * name may be unmapped, or its scope may have no discipline yet. A discipline
 * with no assigned partner still resolves, with a null partner, because the
 * discipline alone is worth showing.
 */
export function resolveActivityTradesWith(
  activities: NamedActivity[],
  scopeDict: Map<string, string>,
  tradeDict: Map<string, OsDiscipline>,
  assignments: Map<number, ProjectAssignment>,
): Map<string, ActivityTrade> {
  const out = new Map<string, ActivityTrade>();
  for (const activity of activities) {
    const scope = scopeDict.get(normalizeName(activity.name));
    if (!scope) continue;
    const discipline = tradeDict.get(scope);
    if (!discipline) continue;
    const assignment = assignments.get(discipline.id);
    out.set(activity.id, {
      disciplineName: discipline.name,
      partnerName: assignment?.name ?? null,
      osPartnerId: assignment?.osPartnerId ?? null,
    });
  }
  return out;
}

/** Three queries regardless of activity count. */
export async function resolveActivityTrades(
  projectId: string,
  activities: NamedActivity[],
): Promise<Map<string, ActivityTrade>> {
  const [scopeDict, tradeDict, assignments] = await Promise.all([
    getDictionary(),
    getTradeDictionary(),
    getProjectAssignments(projectId),
  ]);
  return resolveActivityTradesWith(activities, scopeDict, tradeDict, assignments);
}

/**
 * Whether an activity wears the AT RISK pill: procurement has a behind-schedule
 * item linked to THIS activity specifically (its canonicalActivityKey), and the
 * work is not already done. Scoped to the activity, not the whole trade partner
 * — a partner can carry many activities, and only the one a late item is linked
 * to should light up. Completed work cannot be threatened by late material.
 */
export function isActivityAtRisk(
  activityKey: string | null,
  percentComplete: number | null,
  flaggedActivityKeys: Set<string>,
): boolean {
  if (activityKey === null) return false;
  if (percentComplete === 100) return false;
  return flaggedActivityKeys.has(activityKey);
}

/**
 * Whether the "Procurement risk as of ..." freshness line may render.
 *
 * Cached procurement rows existing is not enough: the line implies "this
 * project was checked", but if no activity's name -> scope -> discipline ->
 * partner chain resolves (an unbuilt scope dictionary, no trade assignments
 * yet), zero pills is not evidence of "nothing flagged" — it is evidence of
 * nothing being checkable at all. The page must never claim it has an answer
 * it does not have.
 */
export function shouldShowProcurementRiskLine(
  hasProcurementRows: boolean,
  trades: Iterable<ActivityTrade>,
): boolean {
  if (!hasProcurementRows) return false;
  for (const trade of trades) {
    if (trade.osPartnerId !== null) return true;
  }
  return false;
}
