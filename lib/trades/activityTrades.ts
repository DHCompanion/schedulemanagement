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
 * Whether an activity wears the AT RISK pill: its partner is one procurement
 * flagged, and the work is not already done. Completed work cannot be threatened
 * by late material.
 */
export function isActivityAtRisk(
  osPartnerId: number | null,
  percentComplete: number | null,
  flagged: Set<number>,
): boolean {
  if (osPartnerId === null) return false;
  if (percentComplete === 100) return false;
  return flagged.has(osPartnerId);
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

/** Per-partner procurement tallies, as cached from the OS context packet. */
export type ActivityProcurement = {
  itemCount: number;
  behindCount: number;
  submittalLateCount: number;
  projectedLateCount: number;
  releasedAtRiskCount: number;
  missingDatesCount: number;
};

/**
 * Turns a partner's tallies into the lines shown under an activity. Counts are
 * plain tallies — no singular/plural inflection, which would be more code than
 * the clarity it buys.
 *
 * Every figure here is project-wide for the partner, not scoped to the activity
 * being read. The caller's label ("This trade's procurement:") carries that.
 */
export function describeProcurement(
  p: ActivityProcurement,
): { headline: string; details: string[] } {
  const headline =
    p.behindCount > 0
      ? `${p.behindCount} of ${p.itemCount} items behind`
      : `${p.itemCount} items, none behind`;

  const details: string[] = [];

  const lateness: string[] = [];
  if (p.submittalLateCount > 0) lateness.push(`${p.submittalLateCount} submittal late`);
  if (p.projectedLateCount > 0) lateness.push(`${p.projectedLateCount} projected late`);
  if (lateness.length > 0) details.push(lateness.join(", "));

  if (p.releasedAtRiskCount > 0) details.push(`${p.releasedAtRiskCount} released at risk`);
  // Not "behind", but not fine either: procurement cannot assess these at all.
  if (p.missingDatesCount > 0) details.push(`${p.missingDatesCount} with no required-on-site date`);

  return { headline, details };
}
