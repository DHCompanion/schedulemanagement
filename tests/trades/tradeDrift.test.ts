import { describe, it, expect } from "vitest";
import { findTradeDrift, type ActivityWithFields } from "@/lib/trades/tradeDrift";
import type { ActivityTrade } from "@/lib/trades/activityTrades";

const disciplineIdByName = new Map([["26A: ELECTRICAL", 26]]);
const trades = new Map<string, ActivityTrade>([
  ["a1", { disciplineName: "26A: ELECTRICAL", partnerName: "Amber Electrical" }],
  ["a2", { disciplineName: "26A: ELECTRICAL", partnerName: "Amber Electrical" }],
]);
const act = (id: string, partner?: string): ActivityWithFields => ({
  id,
  customFields: partner ? { "Trade Partner": partner } : {},
});

describe("findTradeDrift", () => {
  it("flags a file value that disagrees with the assignment", () => {
    const rows = findTradeDrift([act("a1", "Facility Solutions")], trades, disciplineIdByName, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      osDisciplineId: 26,
      disciplineName: "26A: ELECTRICAL",
      fileValue: "Facility Solutions",
      toolValue: "Amber Electrical",
      activityCount: 1,
    });
  });

  it("does not flag agreement", () => {
    expect(findTradeDrift([act("a1", "Amber Electrical")], trades, disciplineIdByName, new Set())).toEqual([]);
  });

  it("does not flag an activity with no trade column", () => {
    expect(findTradeDrift([act("a1")], trades, disciplineIdByName, new Set())).toEqual([]);
  });

  it("does not flag an activity that resolves to no trade at all", () => {
    expect(findTradeDrift([act("unknown", "Facility Solutions")], trades, disciplineIdByName, new Set())).toEqual([]);
  });

  it("counts activities but keeps distinct file values apart", () => {
    const rows = findTradeDrift(
      [act("a1", "Facility Solutions"), act("a2", "Someone Else")],
      trades,
      disciplineIdByName,
      new Set(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.fileValue).sort()).toEqual(["Facility Solutions", "Someone Else"]);
  });

  it("counts every activity carrying the same disagreeing value", () => {
    const rows = findTradeDrift(
      [act("a1", "Facility Solutions"), act("a2", "Facility Solutions")],
      trades,
      disciplineIdByName,
      new Set(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].activityCount).toBe(2);
  });

  it("honours a dismissal of that exact value", () => {
    const rows = findTradeDrift(
      [act("a1", "Facility Solutions")],
      trades,
      disciplineIdByName,
      new Set(["26::Facility Solutions"]),
    );
    expect(rows).toEqual([]);
  });

  it("still flags a different value once one is dismissed", () => {
    const rows = findTradeDrift(
      [act("a1", "Facility Solutions"), act("a2", "Someone Else")],
      trades,
      disciplineIdByName,
      new Set(["26::Facility Solutions"]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].fileValue).toBe("Someone Else");
  });

  it("flags a file value when the tool has no partner assigned", () => {
    const unassigned = new Map<string, ActivityTrade>([
      ["a1", { disciplineName: "26A: ELECTRICAL", partnerName: null }],
    ]);
    const rows = findTradeDrift([act("a1", "Facility Solutions")], unassigned, disciplineIdByName, new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].toolValue).toBeNull();
  });
});
