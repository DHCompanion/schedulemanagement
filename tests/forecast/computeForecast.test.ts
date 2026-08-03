import { describe, it, expect } from "vitest";
import {
  computeForecast,
  projectDrift,
  type ForecastActivity,
  type ForecastInput,
  type ForecastRelationship,
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

const rel = (pred: number, succ: number, type = "FS", lagMinutes: number | null = 0): ForecastRelationship =>
  ({ predecessorExternalUid: pred, successorExternalUid: succ, type, lagMinutes });

const lateStatus = new Date("2026-08-07T17:00:00Z");
const chain = () => [
  fa({ externalUid: 1, canonicalActivityKey: "1|a" }),
  fa({
    externalUid: 2, canonicalActivityKey: "2|b",
    plannedStart: new Date("2026-08-10T08:00:00Z"),
    plannedFinish: new Date("2026-08-14T17:00:00Z"),
  }),
];

describe("computeForecast relationship pushes", () => {
  it("a predecessor slip pushes an FS successor by the same working days", () => {
    const p = prog("1|a", { status: "in_progress", percentComplete: 20 }); // A: +4d, finish Thu Aug 13
    const out = computeForecast({
      activities: chain(), relationships: [rel(1, 2)], progressByKey: p, statusDate: lateStatus,
    });
    const b = out.get(2)!;
    expect(b.expectedStart!.toISOString()).toBe("2026-08-14T08:00:00.000Z");  // next working date, planned time kept
    expect(b.expectedFinish!.toISOString()).toBe("2026-08-20T17:00:00.000Z"); // planned finish + 4 working days
    expect(b.driftDays).toBe(4);
    expect(b.pushedByUid).toBe(1);
  });

  it("an on-plan predecessor does not push", () => {
    const out = computeForecast({
      activities: chain(), relationships: [rel(1, 2)], progressByKey: new Map(), statusDate,
    });
    expect(out.get(2)!.driftDays).toBe(0);
    expect(out.get(2)!.pushedByUid).toBeNull();
  });

  it("an early-finishing predecessor never pulls a successor earlier than planned", () => {
    const p = prog("1|a", {
      status: "complete",
      actualStart: new Date("2026-08-03T08:00:00Z"),
      actualFinish: new Date("2026-08-04T17:00:00Z"), // 3 days early
      percentComplete: 100,
    });
    const out = computeForecast({ activities: chain(), relationships: [rel(1, 2)], progressByKey: p, statusDate });
    expect(out.get(2)!.expectedStart!.toISOString()).toBe("2026-08-10T08:00:00.000Z");
  });

  it("FS lag is honored in working days via minutesPerDay", () => {
    // A completes Mon Aug 10 (1 day late); lag 960 min = 2 days at 480 mpd →
    // earliest B start = next working date (Tue) + 2 = Thu Aug 13 → 3-day push.
    const p = prog("1|a", {
      status: "complete",
      actualStart: new Date("2026-08-03T08:00:00Z"),
      actualFinish: new Date("2026-08-10T17:00:00Z"),
      percentComplete: 100,
    });
    const out = computeForecast({
      activities: chain(), relationships: [rel(1, 2, "FS", 960)], progressByKey: p,
      statusDate, minutesPerDay: 480,
    });
    expect(out.get(2)!.expectedStart!.toISOString()).toBe("2026-08-13T08:00:00.000Z");
    expect(out.get(2)!.driftDays).toBe(3);
  });

  it("SS ties starts through a chain and attributes the push", () => {
    // C slips +4d (FS) into A; B is SS-tied to A so B's start moves with A's.
    const acts = [
      fa({ externalUid: 3, canonicalActivityKey: "3|c" }), // C: Mon Aug 3 – Fri Aug 7
      fa({
        externalUid: 1, canonicalActivityKey: "1|a",
        plannedStart: new Date("2026-08-10T08:00:00Z"),
        plannedFinish: new Date("2026-08-14T17:00:00Z"),
      }),
      fa({
        externalUid: 2, canonicalActivityKey: "2|b",
        plannedStart: new Date("2026-08-10T08:00:00Z"),
        plannedFinish: new Date("2026-08-12T17:00:00Z"),
        durationDays: 3,
      }),
    ];
    const p = prog("3|c", { status: "in_progress", percentComplete: 20 });
    const out = computeForecast({
      activities: acts, relationships: [rel(3, 1, "FS"), rel(1, 2, "SS")], progressByKey: p,
      statusDate: lateStatus,
    });
    expect(out.get(2)!.expectedStart!.getTime()).toBe(out.get(1)!.expectedStart!.getTime());
    expect(out.get(2)!.pushedByUid).toBe(1);
  });

  it("a started successor is never pushed (out-of-sequence)", () => {
    const p = new Map([
      ...prog("1|a", { status: "in_progress", percentComplete: 20 }),
      ...prog("2|b", { status: "in_progress", percentComplete: 50, actualStart: new Date("2026-08-05T08:00:00Z") }),
    ]);
    const out = computeForecast({
      activities: chain(), relationships: [rel(1, 2)], progressByKey: p, statusDate: lateStatus,
    });
    expect(out.get(2)!.expectedStart!.toISOString()).toBe("2026-08-05T08:00:00.000Z");
    expect(out.get(2)!.pushedByUid).toBeNull();
  });

  it("FF and SF edges do not push in v1", () => {
    const p = prog("1|a", { status: "in_progress", percentComplete: 20 });
    const out = computeForecast({
      activities: chain(), relationships: [rel(1, 2, "FF")], progressByKey: p, statusDate: lateStatus,
    });
    expect(out.get(2)!.driftDays).toBe(0);
  });

  it("drift propagates undiminished through a multi-hop chain", () => {
    const acts = [
      ...chain(),
      fa({
        externalUid: 3, canonicalActivityKey: "3|c",
        plannedStart: new Date("2026-08-17T08:00:00Z"),
        plannedFinish: new Date("2026-08-21T17:00:00Z"),
      }),
    ];
    const p = prog("1|a", { status: "in_progress", percentComplete: 20 });
    const out = computeForecast({
      activities: acts, relationships: [rel(1, 2), rel(2, 3)], progressByKey: p, statusDate: lateStatus,
    });
    expect(out.get(3)!.driftDays).toBe(4);
    expect(out.get(3)!.pushedByUid).toBe(2);
  });

  it("a relationship cycle does not hang and members fall back to planned dates", () => {
    const out = computeForecast({
      activities: chain(), relationships: [rel(1, 2), rel(2, 1)], progressByKey: new Map(), statusDate,
    });
    expect(out.get(1)!.driftDays).toBe(0);
    expect(out.get(2)!.driftDays).toBe(0);
  });
});

describe("projectDrift", () => {
  it("is the drift of the latest-finishing incomplete activity", () => {
    const acts = chain();
    const p = prog("1|a", { status: "in_progress", percentComplete: 20 });
    const out = computeForecast({ activities: acts, relationships: [rel(1, 2)], progressByKey: p, statusDate: lateStatus });
    expect(projectDrift(acts, out, p)).toEqual({ driftDays: 4, activityUid: 2 });
  });

  it("ignores completed activities even when they finished latest", () => {
    const acts = [
      fa({ externalUid: 1, canonicalActivityKey: "1|a" }),
      fa({
        externalUid: 2, canonicalActivityKey: "2|b",
        plannedStart: new Date("2026-07-06T08:00:00Z"),
        plannedFinish: new Date("2026-07-10T17:00:00Z"),
      }),
    ];
    const p = prog("1|a", {
      status: "complete",
      actualStart: new Date("2026-08-03T08:00:00Z"),
      actualFinish: new Date("2026-08-20T17:00:00Z"), // way late, but done
      percentComplete: 100,
    });
    const pd = projectDrift(acts, computeForecast({ activities: acts, relationships: [], progressByKey: p, statusDate }), p);
    expect(pd.activityUid).toBe(2);
    expect(pd.driftDays).toBe(0);
  });

  it("is zero with no incomplete activities", () => {
    const acts = [fa({ externalUid: 1, canonicalActivityKey: "1|a", actualFinish: new Date("2026-08-07T17:00:00Z"), percentComplete: 100 })];
    const pd = projectDrift(acts, computeForecast({ activities: acts, relationships: [], progressByKey: new Map(), statusDate }), new Map());
    expect(pd).toEqual({ driftDays: 0, activityUid: null });
  });
});
