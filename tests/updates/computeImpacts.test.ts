import { describe, it, expect } from "vitest";
import { computeImpacts } from "@/lib/updates/computeImpacts";
import type { ForecastActivity, ForecastRelationship } from "@/lib/forecast/computeForecast";
import type { ActivityProgress } from "@/lib/lookahead/computeLookahead";

// Mon Aug 3 .. Fri Aug 7 (A), Mon Aug 10 .. Fri Aug 14 (B), A -> B finish-to-start.
const statusDate = new Date("2026-08-07T17:00:00Z");
function fa(p: Partial<ForecastActivity>): ForecastActivity {
  return {
    externalUid: 1, canonicalActivityKey: "1|a", type: "task", isActive: true,
    plannedStart: new Date("2026-08-03T08:00:00Z"), plannedFinish: new Date("2026-08-07T17:00:00Z"),
    durationDays: 5, actualStart: null, actualFinish: null, percentComplete: null, ...p,
  };
}
const activities = [
  fa({}),
  fa({ externalUid: 2, canonicalActivityKey: "2|b", plannedStart: new Date("2026-08-10T08:00:00Z"), plannedFinish: new Date("2026-08-14T17:00:00Z") }),
];
const relationships: ForecastRelationship[] = [{ predecessorExternalUid: 1, successorExternalUid: 2, type: "FS", lagMinutes: 0 }];
const p = (key: string, x: Partial<ActivityProgress>) =>
  new Map<string, ActivityProgress>([[key, { status: "not_started", actualStart: null, actualFinish: null, percentComplete: null, note: null, ...x }]]);
const run = (before: Map<string, ActivityProgress>, after: Map<string, ActivityProgress>) =>
  computeImpacts({ activities, relationships, before, after, statusDate });

describe("computeImpacts", () => {
  it("reports nothing when the edit moves no successor", () => {
    expect(run(new Map(), p("1|a", { status: "in_progress", percentComplete: 100 }))).toEqual([]);
  });

  it("reports a push when a predecessor's new progress slips its successor", () => {
    const out = run(new Map(), p("1|a", { status: "in_progress", percentComplete: 20 })); // 4 days left from Aug 7 → +4d
    expect(out).toEqual([{
      externalUid: 2, canonicalActivityKey: "2|b", kind: "push", drivenByUid: 1,
      currentStart: "2026-08-10T08:00:00.000Z", currentFinish: "2026-08-14T17:00:00.000Z",
      proposedStart: "2026-08-14T08:00:00.000Z", proposedFinish: "2026-08-20T17:00:00.000Z",
    }]);
  });

  it("reports a pull when a predecessor finishes early", () => {
    const out = run(new Map(), p("1|a", { status: "complete", actualFinish: new Date("2026-08-05T17:00:00Z") }));
    expect(out).toMatchObject([{ externalUid: 2, kind: "pull", proposedStart: "2026-08-06T08:00:00.000Z", proposedFinish: "2026-08-12T17:00:00.000Z" }]);
  });

  it("does not re-report a push the saved draft already caused", () => {
    const slip = p("1|a", { status: "in_progress", percentComplete: 20 });
    expect(run(slip, slip)).toEqual([]);
  });

  it("measures the current dates from accepted forecast dates", () => {
    const after = p("1|a", { status: "in_progress", percentComplete: 20 });
    after.set("2|b", { ...after.get("1|a")!, status: "not_started", percentComplete: null, forecastStart: new Date("2026-08-11T08:00:00Z"), forecastFinish: new Date("2026-08-17T17:00:00Z") });
    const before = new Map([["2|b", after.get("2|b")!]]);
    expect(run(before, after)).toMatchObject([{ currentStart: "2026-08-11T08:00:00.000Z", proposedStart: "2026-08-14T08:00:00.000Z", proposedFinish: "2026-08-20T17:00:00.000Z" }]);
  });
});
