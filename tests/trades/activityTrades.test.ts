import { describe, it, expect } from "vitest";
import {
  resolveActivityTradesWith,
  isActivityAtRisk,
  shouldShowProcurementRiskLine,
  describeProcurement,
  type ActivityTrade,
  type ActivityProcurement,
} from "@/lib/trades/activityTrades";
import type { OsDiscipline, ProjectAssignment } from "@/lib/trades/tradesService";

const scopeDict = new Map([["hang drywall l2", "Hang Drywall"]]);
const tradeDict = new Map<string, OsDiscipline>([
  ["Hang Drywall", { id: 9, name: "09A: DRYWALL/ACOUSTICAL", division: "" }],
]);
const assignments = new Map<number, ProjectAssignment>([
  [9, { osPartnerId: 4, name: "Carrco Painting Contractors, Inc.", onRoster: true }],
]);

describe("resolveActivityTradesWith", () => {
  it("resolves name to discipline and partner", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "Hang Drywall L2" }], scopeDict, tradeDict, assignments);
    expect(out.get("a1")).toEqual({
      disciplineName: "09A: DRYWALL/ACOUSTICAL",
      partnerName: "Carrco Painting Contractors, Inc.",
      osPartnerId: 4,
    });
  });

  it("omits an activity whose name is not in the scope dictionary", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "Mystery Task" }], scopeDict, tradeDict, assignments);
    expect(out.has("a1")).toBe(false);
  });

  it("omits an activity whose scope has no discipline", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "Hang Drywall L2" }], scopeDict, new Map(), assignments);
    expect(out.has("a1")).toBe(false);
  });

  it("returns the discipline with a null partner when none is assigned", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "Hang Drywall L2" }], scopeDict, tradeDict, new Map());
    expect(out.get("a1")).toEqual({
      disciplineName: "09A: DRYWALL/ACOUSTICAL",
      partnerName: null,
      osPartnerId: null,
    });
  });

  it("matches names case- and whitespace-insensitively", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "  HANG   drywall l2 " }], scopeDict, tradeDict, assignments);
    expect(out.get("a1")?.partnerName).toBe("Carrco Painting Contractors, Inc.");
  });
});

describe("isActivityAtRisk", () => {
  const flagged = new Set([77]);

  it("flags an activity whose partner procurement marked at risk", () => {
    expect(isActivityAtRisk(77, 40, flagged)).toBe(true);
  });

  it("does not flag a partner procurement left alone", () => {
    expect(isActivityAtRisk(91, 40, flagged)).toBe(false);
  });

  it("does not flag an activity with no assigned partner", () => {
    expect(isActivityAtRisk(null, 40, flagged)).toBe(false);
  });

  it("suppresses the pill once the work is complete", () => {
    // Finished work cannot be threatened by late material.
    expect(isActivityAtRisk(77, 100, flagged)).toBe(false);
  });

  it("flags an activity with unknown progress", () => {
    expect(isActivityAtRisk(77, null, flagged)).toBe(true);
  });
});

describe("shouldShowProcurementRiskLine", () => {
  const resolved: ActivityTrade = { disciplineName: "09A: DRYWALL/ACOUSTICAL", partnerName: "Carrco", osPartnerId: 4 };
  const unresolved: ActivityTrade = { disciplineName: "09A: DRYWALL/ACOUSTICAL", partnerName: null, osPartnerId: null };

  it("shows the line when rows exist and at least one activity resolves to a partner", () => {
    expect(shouldShowProcurementRiskLine(true, [unresolved, resolved])).toBe(true);
  });

  it("hides the line when rows exist but no activity resolves to a partner", () => {
    expect(shouldShowProcurementRiskLine(true, [unresolved, unresolved])).toBe(false);
  });

  it("hides the line when there are no procurement rows at all", () => {
    expect(shouldShowProcurementRiskLine(false, [resolved])).toBe(false);
  });
});

describe("describeProcurement", () => {
  const base = {
    itemCount: 9,
    behindCount: 0,
    submittalLateCount: 0,
    projectedLateCount: 0,
    releasedAtRiskCount: 0,
    missingDatesCount: 0,
  };

  it("leads with the behind count against the total", () => {
    const r = describeProcurement({ ...base, behindCount: 8, submittalLateCount: 7, projectedLateCount: 1 });
    expect(r.headline).toBe("8 of 9 items behind");
  });

  it("joins both lateness kinds into one line", () => {
    const r = describeProcurement({ ...base, behindCount: 8, submittalLateCount: 7, projectedLateCount: 1 });
    expect(r.details).toEqual(["7 submittal late, 1 projected late"]);
  });

  it("names only the lateness kind that applies", () => {
    const r = describeProcurement({ ...base, behindCount: 7, submittalLateCount: 7 });
    expect(r.details).toEqual(["7 submittal late"]);
    const p = describeProcurement({ ...base, behindCount: 2, projectedLateCount: 2 });
    expect(p.details).toEqual(["2 projected late"]);
  });

  it("says so plainly when nothing is behind", () => {
    expect(describeProcurement(base).headline).toBe("9 items, none behind");
    expect(describeProcurement(base).details).toEqual([]);
  });

  it("reports unassessable items even when nothing is behind", () => {
    // The state this whole feature exists to make visible: without this line a
    // partner whose every item lacks dates reads exactly like one that is fine.
    const r = describeProcurement({ ...base, itemCount: 6, missingDatesCount: 6 });
    expect(r.headline).toBe("6 items, none behind");
    expect(r.details).toEqual(["6 with no required-on-site date"]);
  });

  it("reports released-at-risk items alongside lateness", () => {
    const r = describeProcurement({
      ...base, behindCount: 1, projectedLateCount: 1, releasedAtRiskCount: 1,
    });
    expect(r.details).toEqual(["1 projected late", "1 released at risk"]);
  });

  it("orders details as lateness, then at-risk, then missing dates", () => {
    const r = describeProcurement({
      ...base, itemCount: 12, behindCount: 3, submittalLateCount: 2,
      projectedLateCount: 1, releasedAtRiskCount: 4, missingDatesCount: 5,
    });
    expect(r.details).toEqual([
      "2 submittal late, 1 projected late",
      "4 released at risk",
      "5 with no required-on-site date",
    ]);
  });

  it("handles a partner with no items", () => {
    const r = describeProcurement({ ...base, itemCount: 0 });
    expect(r.headline).toBe("0 items, none behind");
    expect(r.details).toEqual([]);
  });
});
