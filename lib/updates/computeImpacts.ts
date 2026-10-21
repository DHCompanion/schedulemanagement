import {
  computeForecast,
  type ActivityForecast,
  type ForecastActivity,
  type ForecastRelationship,
} from "@/lib/forecast/computeForecast";
import { addWorkingDays, workingDaysBetween } from "@/lib/forecast/workingDays";
import { baselineProgress, type ActivityProgress } from "@/lib/lookahead/computeLookahead";

export interface Impact {
  externalUid: number;
  canonicalActivityKey: string;
  kind: "push" | "pull";
  drivenByUid: number | null;
  currentStart: string;
  currentFinish: string;
  proposedStart: string;
  proposedFinish: string;
}

export interface ImpactInput {
  activities: ForecastActivity[];
  relationships: ForecastRelationship[];
  before: Map<string, ActivityProgress>;
  after: Map<string, ActivityProgress>;
  statusDate: Date;
  minutesPerDay?: number | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : "");

function startDelta(before: ActivityForecast | undefined, after: ActivityForecast | undefined): number {
  if (!before?.expectedStart || !after?.expectedStart) return 0;
  return workingDaysBetween(before.expectedStart, after.expectedStart);
}

/**
 * Not-started activities whose dates the edit (before → after) moves. Pushes
 * come from the normal never-earlier forecast, so slack still absorbs a slip;
 * pulls come from an allowPull run and shift by only the delta the edit caused,
 * so an early finish never also drags work into slack it already had.
 */
export function computeImpacts(input: ImpactInput): Impact[] {
  const run = (progressByKey: Map<string, ActivityProgress>, allowPull: boolean) =>
    computeForecast({ ...input, progressByKey, allowPull });
  const pushBefore = run(input.before, false);
  const pushAfter = run(input.after, false);
  const pullBefore = run(input.before, true);
  const pullAfter = run(input.after, true);

  const out: Impact[] = [];
  for (const a of input.activities) {
    const p = input.after.get(a.canonicalActivityKey) ?? baselineProgress(a);
    if (p.status !== "not_started") continue;
    const current = pushAfter.get(a.externalUid);
    const currentStart = p.forecastStart ?? a.plannedStart;
    const currentFinish = p.forecastFinish ?? a.plannedFinish;
    if (!current?.expectedStart || !currentStart) continue;

    let proposed = current;
    let drivenByUid = current.pushedByUid;
    if (startDelta(pushBefore.get(a.externalUid), current) === 0) {
      const pull = startDelta(pullBefore.get(a.externalUid), pullAfter.get(a.externalUid));
      if (pull >= 0) continue;
      proposed = {
        ...current,
        expectedStart: addWorkingDays(current.expectedStart, pull),
        expectedFinish: current.expectedFinish ? addWorkingDays(current.expectedFinish, pull) : null,
      };
      drivenByUid = pullAfter.get(a.externalUid)!.pushedByUid;
    }
    const shift = workingDaysBetween(currentStart, proposed.expectedStart!);
    if (shift === 0) continue;
    out.push({
      externalUid: a.externalUid,
      canonicalActivityKey: a.canonicalActivityKey,
      kind: shift > 0 ? "push" : "pull",
      drivenByUid,
      currentStart: iso(currentStart),
      currentFinish: iso(currentFinish),
      proposedStart: iso(proposed.expectedStart),
      proposedFinish: iso(proposed.expectedFinish),
    });
  }
  return out;
}
