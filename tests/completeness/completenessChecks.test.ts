import { describe, it, expect } from "vitest";
import { checkCompleteness, summarizeCompleteness, type CompletenessActivity } from "@/lib/completeness/completenessChecks";

function act(overrides: Partial<CompletenessActivity> = {}): CompletenessActivity {
  return {
    canonicalActivityKey: "1|task",
    externalId: 1,
    wbsCode: "1",
    name: "MEP Rough",
    ...overrides,
  };
}

describe("checkCompleteness", () => {
  it("flags an activity whose name has a split rule", () => {
    const rules = new Map([["MEP Rough", ["Electrical Rough-In", "Mechanical Rough-In", "Plumbing Rough-In"]]]);
    const issues = checkCompleteness([act()], rules);
    expect(issues).toHaveLength(1);
    expect(issues[0].coarseScope).toBe("MEP Rough");
    expect(issues[0].finerScopes).toEqual(["Electrical Rough-In", "Mechanical Rough-In", "Plumbing Rough-In"]);
  });

  it("does not flag a name with no split rule", () => {
    const rules = new Map([["Other Scope", ["A", "B"]]]);
    expect(checkCompleteness([act()], rules)).toEqual([]);
  });

  it("matches the rule regardless of case and spacing, and reports the rule's spelling", () => {
    const rules = new Map([["MEP Rough", ["A", "B"]]]);
    const issues = checkCompleteness([act({ name: "  mep   rough " })], rules);
    expect(issues).toHaveLength(1);
    expect(issues[0].coarseScope).toBe("MEP Rough");
  });

  it("ignores a rule with no finer scopes", () => {
    expect(checkCompleteness([act()], new Map([["MEP Rough", []]]))).toEqual([]);
  });

  it("returns nothing for empty split rules", () => {
    expect(checkCompleteness([act()], new Map())).toEqual([]);
  });
});

describe("summarizeCompleteness", () => {
  it("counts issues by coarse scope", () => {
    const issues = checkCompleteness(
      [act({ canonicalActivityKey: "1|a" }), act({ canonicalActivityKey: "2|a" }), act({ canonicalActivityKey: "3|a", name: "Other" })],
      new Map([["MEP Rough", ["A", "B"]], ["Other", ["C", "D"]]]),
    );
    const summary = summarizeCompleteness(issues);
    expect(summary.total).toBe(3);
    expect(summary.byCoarseScope).toEqual(
      expect.arrayContaining([{ coarseScope: "MEP Rough", count: 2 }, { coarseScope: "Other", count: 1 }]),
    );
  });
});
