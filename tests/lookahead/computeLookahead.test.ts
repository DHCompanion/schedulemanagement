import { describe, it, expect } from "vitest";
import {
  computeLookahead, computeSlippage, defaultProgress,
  type LookaheadActivity, type ActivityProgress,
} from "@/lib/lookahead/computeLookahead";

const asOf = new Date("2026-06-18T00:00:00Z");

function act(p: Partial<LookaheadActivity>): LookaheadActivity {
  return {
    externalUid: 1, canonicalActivityKey: "1|a", wbsCode: "1", name: "A",
    type: "task", isActive: true, plannedStart: null, plannedFinish: null, ...p,
  };
}
const empty = new Map<string, ActivityProgress>();

describe("computeLookahead inclusion", () => {
  it("includes an activity starting within the window", () => {
    const rows = computeLookahead([act({ plannedStart: new Date("2026-06-25T00:00:00Z") })], empty, asOf, 3);
    expect(rows.length).toBe(1);
  });
  it("includes an activity finishing within the window", () => {
    const rows = computeLookahead([act({ plannedFinish: new Date("2026-06-25T00:00:00Z") })], empty, asOf, 3);
    expect(rows.length).toBe(1);
  });
  it("includes an activity spanning the as-of date", () => {
    const rows = computeLookahead([act({ plannedStart: new Date("2026-06-01T00:00:00Z"), plannedFinish: new Date("2026-07-30T00:00:00Z") })], empty, asOf, 3);
    expect(rows.length).toBe(1);
  });
  it("includes past-due incomplete via the catch-all", () => {
    const rows = computeLookahead([act({ plannedFinish: new Date("2026-06-10T00:00:00Z") })], empty, asOf, 3);
    expect(rows.length).toBe(1);
    expect(rows[0].slippage).toBe("overdue");
  });
  it("includes in-progress even if planned dates are outside the window", () => {
    const prog = new Map<string, ActivityProgress>([["1|a", { ...defaultProgress(), status: "in_progress" }]]);
    const rows = computeLookahead([act({ plannedStart: new Date("2026-09-01T00:00:00Z") })], prog, asOf, 3);
    expect(rows.length).toBe(1);
  });
  it("excludes activity entirely outside the window with no progress", () => {
    const rows = computeLookahead([act({ plannedStart: new Date("2026-09-01T00:00:00Z"), plannedFinish: new Date("2026-09-10T00:00:00Z") })], empty, asOf, 3);
    expect(rows.length).toBe(0);
  });
  it("excludes summary and inactive activities", () => {
    const inWindow = new Date("2026-06-25T00:00:00Z");
    const rows = computeLookahead([
      act({ externalUid: 1, type: "summary", plannedStart: inWindow }),
      act({ externalUid: 2, type: "project_summary", plannedStart: inWindow }),
      act({ externalUid: 3, isActive: false, plannedStart: inWindow }),
    ], empty, asOf, 3);
    expect(rows.length).toBe(0);
  });
  it("excludes past-due that is already complete", () => {
    const prog = new Map<string, ActivityProgress>([["1|a", { ...defaultProgress(), status: "complete" }]]);
    const rows = computeLookahead([act({ plannedFinish: new Date("2026-06-10T00:00:00Z") })], prog, asOf, 3);
    expect(rows.length).toBe(0);
  });
  it("6-week window includes what 3-week excludes", () => {
    const a = [act({ plannedStart: new Date("2026-07-20T00:00:00Z") })];
    expect(computeLookahead(a, empty, asOf, 3).length).toBe(0);
    expect(computeLookahead(a, empty, asOf, 6).length).toBe(1);
  });
  it("1-week window excludes work starting beyond a week that 3-week includes", () => {
    const a = [act({ plannedStart: new Date("2026-06-28T00:00:00Z") })];
    expect(computeLookahead(a, empty, asOf, 1).length).toBe(0);
    expect(computeLookahead(a, empty, asOf, 3).length).toBe(1);
  });
  it("includes an older not-started item even with no planned finish", () => {
    const rows = computeLookahead([act({ plannedStart: new Date("2026-06-10T00:00:00Z"), plannedFinish: null })], empty, asOf, 1);
    expect(rows.length).toBe(1);
    expect(rows[0].slippage).toBe("should-have-started");
  });
});

describe("computeSlippage", () => {
  it("flags should-have-started for an unstarted past-start activity", () => {
    const s = computeSlippage(act({ plannedStart: new Date("2026-06-10T00:00:00Z") }), defaultProgress(), asOf);
    expect(s).toBe("should-have-started");
  });
  it("flags on-track for a future activity", () => {
    const s = computeSlippage(act({ plannedStart: new Date("2026-06-25T00:00:00Z") }), defaultProgress(), asOf);
    expect(s).toBe("on-track");
  });
});
