import { describe, it, expect } from "vitest";
import {
  computeForecast,
  type ForecastActivity,
  type ForecastInput,
} from "@/lib/forecast/computeForecast";
import type { ActivityProgress } from "@/lib/lookahead/computeLookahead";

// 2026-08-03 is a Monday; statusDate is the Friday before.
const statusDate = new Date("2026-07-31T17:00:00Z");

export function fa(p: Partial<ForecastActivity>): ForecastActivity {
  return {
    externalUid: 1, canonicalActivityKey: "1|a", type: "task", isActive: true,
    plannedStart: new Date("2026-08-03T08:00:00Z"),
    plannedFinish: new Date("2026-08-07T17:00:00Z"),
    durationDays: 5, actualStart: null, actualFinish: null, percentComplete: null,
    ...p,
  };
}

export const prog = (key: string, p: Partial<ActivityProgress>): Map<string, ActivityProgress> =>
  new Map([[key, { status: "not_started", actualStart: null, actualFinish: null, percentComplete: null, note: null, ...p }]]);

function run(activities: ForecastActivity[], progress?: Map<string, ActivityProgress>, extra?: Partial<ForecastInput>) {
  return computeForecast({ activities, relationships: [], progressByKey: progress ?? new Map(), statusDate, ...extra });
}

describe("computeForecast status rules", () => {
  it("omits summaries, project summaries, and inactive activities", () => {
    const out = run([
      fa({ externalUid: 1, type: "summary" }),
      fa({ externalUid: 2, type: "project_summary" }),
      fa({ externalUid: 3, isActive: false }),
      fa({ externalUid: 4 }),
    ]);
    expect([...out.keys()]).toEqual([4]);
  });

  it("on-plan not-started: expected dates equal planned dates exactly, zero drift", () => {
    const f = run([fa({})]).get(1)!;
    expect(f.expectedStart!.toISOString()).toBe("2026-08-03T08:00:00.000Z");
    expect(f.expectedFinish!.toISOString()).toBe("2026-08-07T17:00:00.000Z");
    expect(f.driftDays).toBe(0);
    expect(f.pushedByUid).toBeNull();
  });

  it("completed: actuals win and drift is frozen history (can be negative)", () => {
    const p = prog("1|a", {
      status: "complete",
      actualStart: new Date("2026-08-03T08:00:00Z"),
      actualFinish: new Date("2026-08-06T17:00:00Z"), // finished Thu, planned Fri
      percentComplete: 100,
    });
    const f = run([fa({})], p).get(1)!;
    expect(f.expectedFinish!.toISOString()).toBe("2026-08-06T17:00:00.000Z");
    expect(f.driftDays).toBe(-1);
  });

  it("in-progress on/ahead of plan clamps to the planned finish", () => {
    // 5-day task, 20% done at Fri Jul 31 statusDate → 4 days remain → Thu Aug 6,
    // earlier than planned Fri Aug 7 → clamped to plan, drift 0.
    const p20 = prog("1|a", { status: "in_progress", percentComplete: 20 });
    const f20 = run([fa({})], p20).get(1)!;
    expect(f20.expectedFinish!.toISOString()).toBe("2026-08-07T17:00:00.000Z");
    expect(f20.driftDays).toBe(0);
    // 90% done → clamp again; never earlier than planned.
    const p90 = prog("1|a", { status: "in_progress", percentComplete: 90 });
    expect(run([fa({})], p90).get(1)!.driftDays).toBe(0);
  });

  it("in-progress behind plan shows positive drift from the status date", () => {
    // statusDate Fri Aug 7, still only 20% done → 4 working days remain → Thu Aug 13 → +4d.
    const p = prog("1|a", { status: "in_progress", percentComplete: 20 });
    const f = computeForecast({
      activities: [fa({})], relationships: [], progressByKey: p,
      statusDate: new Date("2026-08-07T17:00:00Z"),
    }).get(1)!;
    expect(f.driftDays).toBe(4);
    expect(f.expectedFinish!.getUTCDate()).toBe(13);
  });

  it("imported actuals seed progress when no in-app update exists", () => {
    const f = run([fa({ actualStart: new Date("2026-08-03T08:00:00Z"), actualFinish: new Date("2026-08-05T17:00:00Z"), percentComplete: 100 })]).get(1)!;
    expect(f.expectedFinish!.toISOString()).toBe("2026-08-05T17:00:00.000Z");
  });

  it("milestone keeps its planned timestamps when unpushed", () => {
    const ms = new Date("2026-08-03T08:00:00Z");
    const f = run([fa({ type: "milestone", durationDays: 0, plannedStart: ms, plannedFinish: ms })]).get(1)!;
    expect(f.expectedStart!.toISOString()).toBe(ms.toISOString());
    expect(f.expectedFinish!.toISOString()).toBe(ms.toISOString());
  });

  it("null durationDays derives remaining duration from the planned span", () => {
    const p = prog("1|a", { status: "in_progress", percentComplete: 0 });
    // planned Mon Aug 3 .. Fri Aug 7 = 4 working-day span; statusDate Fri Aug 7 + 4 → Thu Aug 13.
    const f = computeForecast({
      activities: [fa({ durationDays: null })], relationships: [], progressByKey: p,
      statusDate: new Date("2026-08-07T17:00:00Z"),
    }).get(1)!;
    expect(f.expectedFinish!.getUTCDate()).toBe(13);
  });

  it("null planned dates degrade gracefully", () => {
    const f = run([fa({ plannedStart: null, plannedFinish: null, durationDays: null })]).get(1)!;
    expect(f.expectedStart).toBeNull();
    expect(f.driftDays).toBe(0);
  });
});
