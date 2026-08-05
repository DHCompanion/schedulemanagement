import { describe, it, expect } from "vitest";
import { buildLookaheadView, tradeColor } from "@/lib/lookahead/lookaheadView";
import type { ScheduleRow } from "@/lib/schedule/types";

// Mon Aug 3 2026 starts the window; "today" is mid-week to prove Monday alignment.
const today = new Date("2026-08-05T12:00:00Z");

const row = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: "a1", externalId: 101, wbsCode: "1.2", name: "MEP R/I L2", canonicalScope: "Overhead MEP Rough-In",
  disciplineName: "Mechanical", partnerName: "TDIndustries", atRisk: false, procurement: null,
  type: "task", isCritical: false, outlineLevel: 2,
  plannedStart: "2026-08-03T08:00:00.000Z", plannedFinish: "2026-08-07T17:00:00.000Z",
  expectedStart: "2026-08-03T08:00:00.000Z", expectedFinish: "2026-08-07T17:00:00.000Z",
  driftDays: 0, pushedByName: null, status: "not_started",
  percentComplete: 0, totalSlackDays: 3, durationDays: 5, customFields: {},
  ...over,
});

const build = (rows: ScheduleRow[], over: Partial<Parameters<typeof buildLookaheadView>[0]> = {}) =>
  buildLookaheadView({
    rows, projectDriftDays: 0, statusDate: "2026-08-04T17:00:00.000Z",
    percentComplete: 42, lastUpdateDaysAgo: 2, weeks: 3, today, ...over,
  });

describe("window framing", () => {
  it("titles and labels the window from Monday for the requested weeks", () => {
    const v = build([row()]);
    expect(v.title).toBe("3-Week Lookahead");
    expect(v.windowLabel).toBe("Aug 3–23, 2026"); // inclusive last day = Monday + 21d - 1d
    expect(build([row()], { weeks: 6 }).windowLabel).toBe("Aug 3–Sep 13, 2026");
    expect(v.statusDateLabel).toBe("Aug 4, 2026");
    expect(v.generatedLabel).toBe("Aug 5, 2026");
  });

  it("draws the today line and shades weekends", () => {
    const v = build([row()]);
    expect(v.todayPct).toBeGreaterThan(0);
    expect(v.weekends.length).toBe(3); // one weekend per week in a 3-week window
    expect(v.ticks.length).toBeGreaterThan(0);
  });
});

describe("banding", () => {
  it("groups by trade, names the partners, and sinks untraded work to a final Unassigned band", () => {
    const v = build([
      row({ id: "a1", disciplineName: "Mechanical", partnerName: "TDIndustries" }),
      row({ id: "a2", name: "Duct", disciplineName: "Mechanical", partnerName: "Acme Air" }),
      row({ id: "a3", name: "Slab", disciplineName: null, partnerName: null }),
      row({ id: "a4", name: "Conduit", disciplineName: "Electrical", partnerName: "Fisk" }),
    ]);
    expect(v.bands.map((b) => b.trade)).toEqual(["Electrical", "Mechanical", "Unassigned"]);
    expect(v.bands[1].partners).toEqual(["Acme Air", "TDIndustries"]);
    expect(v.bands[2].color.bg).toBe("#f1f5f9"); // Unassigned is always the neutral grey
  });

  it("excludes summary rows and anything outside the window", () => {
    const v = build([
      row(),
      row({ id: "s", type: "summary", name: "Level 2" }),
      row({ id: "far", name: "Punch", expectedStart: "2026-12-01T08:00:00.000Z", expectedFinish: "2026-12-05T17:00:00.000Z" }),
    ]);
    expect(v.bands.flatMap((b) => b.rows).map((r) => r.id)).toEqual(["a1"]);
  });

  it("positions the bar, the ghost planned-finish tick, and milestone diamonds", () => {
    const v = build([
      row({ id: "a1", driftDays: 3, expectedFinish: "2026-08-12T17:00:00.000Z", percentComplete: 40 }),
      row({ id: "m1", name: "Permit", type: "milestone", plannedFinish: "2026-08-10T17:00:00.000Z", expectedFinish: "2026-08-13T17:00:00.000Z", driftDays: 3 }),
    ]);
    const rows = v.bands.flatMap((b) => b.rows);
    const bar = rows.find((r) => r.id === "a1")!;
    expect(bar.bar!.widthPct).toBeGreaterThan(0);
    expect(bar.ghostPct).toBeGreaterThan(0); // planned finish differs from expected
    expect(bar.driftDays).toBe(3);
    const ms = rows.find((r) => r.id === "m1")!;
    expect(ms.isMilestone).toBe(true);
    expect(ms.bar).toBeNull();
    expect(ms.plannedPointPct).toBeGreaterThan(0);
    expect(ms.expectedPointPct).toBeGreaterThan(ms.plannedPointPct!);
  });

  it("drops the ghost tick when planned and expected finish agree", () => {
    expect(build([row()]).bands[0].rows[0].ghostPct).toBeNull();
  });
});

describe("stats", () => {
  it("counts at-risk and starting-this-window work inside the window only", () => {
    const v = build(
      [
        row({ id: "a1", atRisk: true }),
        row({ id: "a2", name: "Late", expectedStart: "2026-08-18T08:00:00.000Z", expectedFinish: "2026-08-20T17:00:00.000Z" }),
        row({ id: "a3", name: "In flight", status: "in_progress", percentComplete: 50 }),
        row({ id: "a4", name: "Next year", atRisk: true, expectedStart: "2027-01-04T08:00:00.000Z", expectedFinish: "2027-01-08T17:00:00.000Z" }),
      ],
      { projectDriftDays: 4 },
    );
    expect(v.stats).toEqual({ driftDays: 4, atRiskCount: 1, percentComplete: 42, startingCount: 2 });
  });
});

describe("attention sentences", () => {
  it("names the procurement flag, the drift cause, and the stale update", () => {
    const v = build(
      [
        row({ id: "a1", atRisk: true, partnerName: "TDIndustries", canonicalScope: "Overhead MEP",
              procurement: { itemCount: 9, behindCount: 3, submittalLateCount: 1, projectedLateCount: 2, releasedAtRiskCount: 0, missingDatesCount: 0 } }),
        row({ id: "a2", canonicalScope: "In-Wall Rough-In", driftDays: 3, pushedByName: "MEP Rough-In",
              expectedFinish: "2026-08-12T17:00:00.000Z" }),
      ],
      { lastUpdateDaysAgo: 12 },
    );
    expect(v.attention).toContain("TDIndustries behind on 3 items — Overhead MEP at risk.");
    expect(v.attention).toContain("In-Wall Rough-In pushed +3d by MEP Rough-In.");
    expect(v.attention).toContain("No progress update in 12 days — figures may be stale.");
  });

  it("says so plainly when nothing is flagged", () => {
    expect(build([row()]).attention).toEqual(["Nothing flagged — in-window work is on plan."]);
  });

  it("attributes unexplained drift to the activity itself", () => {
    const v = build([row({ canonicalScope: "Slab Pour", driftDays: 2, pushedByName: null, expectedFinish: "2026-08-11T17:00:00.000Z" })]);
    expect(v.attention).toContain("Slab Pour is running +2d late.");
  });
});

describe("milestone strip", () => {
  it("keeps window milestones and the next three beyond, in expected order", () => {
    const ms = (id: string, iso: string) =>
      row({ id, name: id, canonicalScope: null, type: "milestone", plannedFinish: iso, expectedFinish: iso, expectedStart: iso, plannedStart: iso });
    const v = build([
      ms("m1", "2026-08-10T17:00:00.000Z"),
      ms("m2", "2026-09-01T17:00:00.000Z"),
      ms("m3", "2026-09-08T17:00:00.000Z"),
      ms("m4", "2026-09-15T17:00:00.000Z"),
      ms("m5", "2026-10-01T17:00:00.000Z"),
    ]);
    expect(v.milestones.map((m) => m.name)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(v.milestones.map((m) => m.beyondWindow)).toEqual([false, true, true, true]);
  });
});

describe("tradeColor", () => {
  it("is stable per trade name and varies across trades", () => {
    expect(tradeColor("Mechanical")).toEqual(tradeColor("Mechanical"));
    expect(tradeColor("Mechanical")).not.toEqual(tradeColor("Electrical"));
  });
});
