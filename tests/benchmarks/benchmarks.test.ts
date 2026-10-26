import { describe, it, expect } from "vitest";
import { aggregate, blend, outsideRange, quartiles, scopeSpans, scopeWorkedDays, withoutProcurement } from "@/lib/benchmarks/benchmarks";

const d = (s: string) => new Date(`${s}T08:00:00Z`);
const act = (name: string, start: string, finish: string, actual?: [string | null, string | null]) => ({
  name, type: "task", isActive: true, isMilestone: false,
  plannedStart: d(start), plannedFinish: d(finish),
  actualStart: actual?.[0] ? d(actual[0]) : null, actualFinish: actual?.[1] ? d(actual[1]) : null,
});
const dict = new Map([["frame walls l1", "Frame Walls"], ["frame walls l2", "Frame Walls"], ["paint", "Paint"]]);

describe("scopeSpans", () => {
  it("spans each standard name from its first start to its last finish, in working days inclusive", () => {
    // Mon 3 Mar → Fri 7 Mar is 5 working days; L2 runs to Wed 12 Mar → 8.
    const spans = scopeSpans([act("Frame Walls L1", "2025-03-03", "2025-03-07"), act("Frame Walls L2", "2025-03-05", "2025-03-12"), act("Unmapped", "2025-01-01", "2025-12-31")], dict, "planned");
    expect(Object.fromEntries(spans)).toEqual({ "Frame Walls": 8 });
  });

  it("counts the first day only when it is a working day", () => {
    // Sat 1 Mar → Mon 3 Mar is 1 working day; Sat → Sun is none.
    expect(Object.fromEntries(scopeSpans([act("Paint", "2025-03-01", "2025-03-03")], dict, "planned"))).toEqual({ Paint: 1 });
    expect(Object.fromEntries(scopeSpans([act("Paint", "2025-03-01", "2025-03-02")], dict, "planned"))).toEqual({ Paint: 0 });
  });

  it("counts actuals only for a finished scope, and skips milestones and summaries", () => {
    const acts = [
      act("Frame Walls L1", "2025-03-03", "2025-03-07", ["2025-03-03", "2025-03-10"]),
      act("Frame Walls L2", "2025-03-05", "2025-03-12", ["2025-03-05", null]),
      act("Paint", "2025-03-03", "2025-03-04", ["2025-03-04", "2025-03-04"]),
      { ...act("Paint", "2025-01-01", "2025-06-01", ["2025-01-01", "2025-06-01"]), isMilestone: true },
      { ...act("Paint", "2025-01-01", "2025-06-01", ["2025-01-01", "2025-06-01"]), type: "summary" },
    ];
    expect(Object.fromEntries(scopeSpans(acts, dict, "actual"))).toEqual({ Paint: 1 });
  });
});

describe("scopeWorkedDays", () => {
  it("counts working days with any of the name's activities in progress, not the gaps between them", () => {
    // L1 Mon 3 – Wed 5 Mar, L2 Mon 17 – Tue 18 Mar (two idle weeks between): 5 days worked, though the span is 12.
    const acts = [act("Frame Walls L1", "2025-03-03", "2025-03-05"), act("Frame Walls L2", "2025-03-17", "2025-03-18"), act("Frame Walls L1", "2025-03-04", "2025-03-05")];
    expect(Object.fromEntries(scopeWorkedDays(acts, dict))).toEqual({ "Frame Walls": 5 });
    expect(Object.fromEntries(scopeSpans(acts, dict, "planned"))).toEqual({ "Frame Walls": 12 });
  });
});

describe("quartiles", () => {
  it("interpolates P25, median and P75", () => {
    expect(quartiles([10, 1, 4, 7])).toEqual({ p25: 3.25, median: 5.5, p75: 7.75 });
    expect(quartiles([6])).toEqual({ p25: 6, median: 6, p75: 6 });
  });
});

describe("aggregate", () => {
  it("groups one contribution per project by sector and by building type", () => {
    const c = (days: number, buildingType: string | null) => ({ scope: "Paint", measure: "actual" as const, sector: "Healthcare", buildingType, days });
    const rows = aggregate([c(10, "Clinic"), c(20, "Clinic"), c(30, "OR Suite"), c(40, null)]);
    expect(rows).toContainEqual({ canonicalScope: "Paint", measure: "actual", groupKind: "sector", groupValue: "Healthcare", n: 4, p25: 17.5, median: 25, p75: 32.5 });
    expect(rows).toContainEqual({ canonicalScope: "Paint", measure: "actual", groupKind: "buildingType", groupValue: "Clinic", n: 2, p25: 12.5, median: 15, p75: 17.5 });
    expect(rows).toHaveLength(3);
  });
});

describe("blend", () => {
  const sector = { n: 20, p25: 10, median: 20, p75: 30 };
  it("shrinks the building type toward the sector by n / (n + 5)", () => {
    expect(blend(sector, { n: 5, p25: 20, median: 30, p75: 40 })).toEqual({ p25: 15, median: 25, p75: 35, n: 20, typeN: 5, typeShare: 0.5 });
  });
  it("uses the sector alone without building-type data, and nothing under 5 sector projects", () => {
    expect(blend(sector, undefined)).toMatchObject({ median: 20, typeN: 0, typeShare: 0 });
    expect(blend({ ...sector, n: 4 }, { n: 4, p25: 1, median: 2, p75: 3 })).toBeNull();
  });
});

describe("outsideRange", () => {
  it("flags beyond the Tukey fences P25 − 1.5·IQR and P75 + 1.5·IQR", () => {
    const r = { p25: 10, median: 15, p75: 20 };
    expect([-6, -5, 35, 36].map((x) => outsideRange(x, r))).toEqual([true, false, false, true]);
  });
});

describe("withoutProcurement", () => {
  it("unnames lines under a procurement summary, except preconstruction steps", () => {
    const line = (externalUid: number, name: string, parentExternalUid: number | null) => ({ externalUid, name, parentExternalUid });
    const acts = [
      line(1, "Long Lead Items", null), line(2, "Doors", 1),
      line(3, "Interior Finishout", null), line(4, "Doors", 3),
      line(5, "Submittal Review", null), line(6, "Submittals", 5),
      line(7, "Equipment Install", null), line(8, "Doors", 7),
    ];
    const names = withoutProcurement(acts, new Map([["doors", "Install Doors & Hardware"], ["submittals", "Submittals"]])).map((a) => a.name);
    expect(names).toEqual(["Long Lead Items", "", "Interior Finishout", "Doors", "Submittal Review", "Submittals", "Equipment Install", "Doors"]);
  });
});
