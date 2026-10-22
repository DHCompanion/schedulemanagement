import { describe, it, expect } from "vitest";
import { classifyImport, type TierInput } from "@/lib/health/importTier";
import type { LogicScore } from "@/lib/health/logicChecks";

function logic(overrides: Partial<LogicScore> = {}): LogicScore {
  return {
    metrics: [{ key: "missing_logic", count: 0, denominator: 100, pct: 0, threshold: 0.05, pass: true }],
    passed: 8,
    total: 8,
    score: 1,
    benchmarkEligible: true,
    ...overrides,
  };
}

function input(overrides: Partial<TierInput> = {}): TierInput {
  return { leafCount: 100, relationshipCount: 120, leavesWithActuals: 0, hasStatusDate: false, logic: logic(), ...overrides };
}

describe("classifyImport", () => {
  it("calls a tiny file junk", () => {
    expect(classifyImport(input({ leafCount: 9, relationshipCount: 9 })).tier).toBe("junk");
    expect(classifyImport(input({ leafCount: 10, relationshipCount: 10 })).tier).not.toBe("junk");
  });

  it("calls an ineligible logic score rough", () => {
    const r = classifyImport(input({ logic: logic({ benchmarkEligible: false, score: 0.4, passed: 3 }) }));
    expect(r.tier).toBe("rough");
    expect(r.reasons.join(" ")).toMatch(/3 of 8/);
  });

  it("names missing logic as the reason when that is what failed", () => {
    const failing = logic({
      benchmarkEligible: false,
      metrics: [{ key: "missing_logic", count: 42, denominator: 100, pct: 0.42, threshold: 0.05, pass: false }],
    });
    expect(classifyImport(input({ logic: failing })).reasons.join(" ")).toMatch(/42%/);
  });

  it("calls a thinly linked file rough at the links-per-activity boundary", () => {
    expect(classifyImport(input({ relationshipCount: 79 })).tier).toBe("rough");
    expect(classifyImport(input({ relationshipCount: 80 })).tier).toBe("baseline");
  });

  it("calls a statused file with enough actuals as-built", () => {
    expect(classifyImport(input({ hasStatusDate: true, leavesWithActuals: 10 })).tier).toBe("as_built");
    expect(classifyImport(input({ hasStatusDate: true, leavesWithActuals: 9 })).tier).toBe("baseline");
  });

  it("needs a status date to be as-built", () => {
    expect(classifyImport(input({ hasStatusDate: false, leavesWithActuals: 80 })).tier).toBe("baseline");
  });

  it("always gives at least one reason", () => {
    for (const i of [input({ leafCount: 3 }), input(), input({ hasStatusDate: true, leavesWithActuals: 50 })]) {
      expect(classifyImport(i).reasons.length).toBeGreaterThan(0);
    }
  });
});
