import { describe, it, expect } from "vitest";
import { classifyImport, type TierInput } from "@/lib/health/importTier";
import type { LogicScore } from "@/lib/health/logicChecks";

function logic(overrides: Partial<LogicScore> = {}): LogicScore {
  return {
    metrics: [],
    noPredecessorPct: 0,
    noSuccessorPct: 0,
    passed: 8,
    total: 8,
    score: 1,
    benchmarkEligible: true,
    ...overrides,
  };
}

function input(overrides: Partial<TierInput> = {}): TierInput {
  return { leafCount: 100, relationshipCount: 120, leavesWithActuals: 0, logic: logic(), ...overrides };
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

  it("names loose predecessors and successors as reasons", () => {
    const r = classifyImport(input({ logic: logic({ benchmarkEligible: false, noPredecessorPct: 0.42, noSuccessorPct: 0.6 }) }));
    expect(r.tier).toBe("rough");
    expect(r.reasons.join(" ")).toMatch(/42% of activities have no predecessor/);
    expect(r.reasons.join(" ")).toMatch(/60% of activities have no successor/);
  });

  it("calls a thinly linked file rough at the links-per-activity boundary", () => {
    expect(classifyImport(input({ relationshipCount: 79 })).tier).toBe("rough");
    expect(classifyImport(input({ relationshipCount: 80 })).tier).toBe("baseline");
  });

  it("calls a file with enough actuals as-built", () => {
    expect(classifyImport(input({ leavesWithActuals: 10 })).tier).toBe("as_built");
    expect(classifyImport(input({ leavesWithActuals: 9 })).tier).toBe("baseline");
  });

  it("always gives at least one reason", () => {
    for (const i of [input({ leafCount: 3 }), input(), input({ leavesWithActuals: 50 })]) {
      expect(classifyImport(i).reasons.length).toBeGreaterThan(0);
    }
  });
});
