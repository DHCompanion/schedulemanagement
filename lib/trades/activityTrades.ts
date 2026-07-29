import { normalizeName } from "@/lib/normalize/normalizeName";
import { getDictionary } from "@/lib/normalize/normalizationService";
import {
  getProjectAssignments,
  getTradeDictionary,
  type OsDiscipline,
  type ProjectAssignment,
} from "@/lib/trades/tradesService";

export type ActivityTrade = { disciplineName: string; partnerName: string | null };

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
    out.set(activity.id, {
      disciplineName: discipline.name,
      partnerName: assignments.get(discipline.id)?.name ?? null,
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
