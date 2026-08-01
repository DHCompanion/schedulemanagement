import { describe, it, expect } from "vitest";
import { describeProcurement } from "@/lib/procurement/display";

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
