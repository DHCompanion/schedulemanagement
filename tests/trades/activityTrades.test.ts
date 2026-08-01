import { describe, it, expect } from "vitest";
import {
  resolveActivityTradesWith,
  isActivityAtRisk,
  shouldShowProcurementRiskLine,
  type ActivityTrade,
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
