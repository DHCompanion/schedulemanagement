import { describe, it, expect } from "vitest";
import {
  computeEnvelope,
  checkOutOfEnvelope,
  checkFutureActuals,
  checkMissingDates,
  checkPercentContradictions,
  runHealthChecks,
  summarizeHealth,
  summarizeProgress,
  type HealthActivity,
  type DateWindow,
} from "@/lib/health/dateChecks";

const d = (s: string) => new Date(s);

function act(overrides: Partial<HealthActivity> = {}): HealthActivity {
  return {
    id: "a1",
    externalId: 1,
    wbsCode: "1",
    name: "Task",
    type: "task",
    isActive: true,
    isMilestone: false,
    plannedStart: d("2026-03-02"),
    plannedFinish: d("2026-03-07"),
    actualStart: null,
    actualFinish: null,
    percentComplete: null,
    ...overrides,
  };
}

// A tight 2026-Q2 cluster of healthy activities used to derive an envelope.
function cluster(): HealthActivity[] {
  return Array.from({ length: 10 }, (_, i) => {
    const start = new Date(d("2026-03-02").getTime() + i * 7 * 86400000);
    const finish = new Date(start.getTime() + 5 * 86400000);
    return act({ id: `c${i}`, wbsCode: `${i + 2}`, plannedStart: start, plannedFinish: finish });
  });
}

describe("checkOutOfEnvelope", () => {
  const window: DateWindow = { start: d("2026-01-01"), end: d("2026-12-31") };

  it("flags an activity with a date before the window", () => {
    const issues = checkOutOfEnvelope(act({ plannedStart: d("2025-01-01"), plannedFinish: d("2025-01-05") }), window);
    expect(issues).toHaveLength(1);
    expect(issues[0].check).toBe("out_of_envelope");
    expect(issues[0].severity).toBe("error");
  });

  it("does not flag an activity fully inside the window", () => {
    expect(checkOutOfEnvelope(act(), window)).toEqual([]);
  });

  it("returns nothing when the window is null", () => {
    expect(checkOutOfEnvelope(act({ plannedStart: d("1990-01-01") }), null)).toEqual([]);
  });
});

describe("computeEnvelope", () => {
  it("uses the stored project envelope with a buffer when present", () => {
    const w = computeEnvelope([act()], { projectStart: d("2026-01-01"), projectFinish: d("2026-12-31") });
    expect(w).not.toBeNull();
    // buffered outward by ~180d on each side
    expect(w!.start.getTime()).toBeLessThan(d("2026-01-01").getTime());
    expect(w!.end.getTime()).toBeGreaterThan(d("2026-12-31").getTime());
  });

  it("derives an outlier-robust window from activity dates when no stored envelope", () => {
    const activities = [...cluster(), act({ id: "bad", plannedStart: d("2024-06-01"), plannedFinish: d("2024-06-05") })];
    const w = computeEnvelope(activities, { projectStart: null, projectFinish: null });
    expect(w).not.toBeNull();
    // the lone 2024 outlier must NOT drag the window open enough to include itself
    expect(d("2024-06-01").getTime()).toBeLessThan(w!.start.getTime());
    // the healthy cluster stays inside
    expect(d("2026-03-02").getTime()).toBeGreaterThan(w!.start.getTime());
  });

  it("returns null when there is no stored envelope and too few dated activities", () => {
    const activities = [act({ id: "x", plannedStart: d("2026-03-02"), plannedFinish: d("2026-03-07") })];
    expect(computeEnvelope(activities, { projectStart: null, projectFinish: null })).toBeNull();
  });
});

describe("checkFutureActuals", () => {
  const asOf = d("2026-06-19");

  it("flags an actual finish after the data date", () => {
    const issues = checkFutureActuals(act({ actualFinish: d("2026-07-01") }), asOf);
    expect(issues).toHaveLength(1);
    expect(issues[0].check).toBe("future_actual");
    expect(issues[0].severity).toBe("error");
  });

  it("does not flag actuals on or before the data date", () => {
    expect(checkFutureActuals(act({ actualStart: d("2026-06-01"), actualFinish: d("2026-06-10") }), asOf)).toEqual([]);
  });
});

describe("checkMissingDates", () => {
  it("flags a leaf task missing a planned finish", () => {
    const issues = checkMissingDates(act({ plannedFinish: null }));
    expect(issues).toHaveLength(1);
    expect(issues[0].check).toBe("missing_dates");
    expect(issues[0].severity).toBe("warning");
  });

  it("does not flag a task with both planned dates", () => {
    expect(checkMissingDates(act())).toEqual([]);
  });
});

describe("checkPercentContradictions", () => {
  it("flags 100% complete with no actual finish", () => {
    const issues = checkPercentContradictions(act({ percentComplete: 100, actualFinish: null }));
    expect(issues).toHaveLength(1);
    expect(issues[0].check).toBe("percent_contradiction");
  });

  it("flags an actual finish with percent complete under 100", () => {
    const issues = checkPercentContradictions(act({ percentComplete: 50, actualFinish: d("2026-03-07") }));
    expect(issues).toHaveLength(1);
  });

  it("does not flag a consistent completed task", () => {
    expect(checkPercentContradictions(act({ percentComplete: 100, actualFinish: d("2026-03-07") }))).toEqual([]);
  });
});

describe("runHealthChecks", () => {
  const noEnvelope = { projectStart: null, projectFinish: null };
  const asOf = d("2026-06-19");

  it("catches the lone mis-dated activity and leaves the healthy cluster clean", () => {
    const activities = [...cluster(), act({ id: "bad", wbsCode: "99", plannedStart: d("2024-06-01"), plannedFinish: d("2024-06-05") })];
    const issues = runHealthChecks(activities, noEnvelope, asOf);
    const envIssues = issues.filter((i) => i.check === "out_of_envelope");
    expect(envIssues).toHaveLength(1);
    expect(envIssues[0].activityId).toBe("bad");
  });

  it("skips summary and inactive activities", () => {
    const activities = [
      ...cluster(),
      act({ id: "sum", type: "summary", plannedStart: d("2024-06-01"), plannedFinish: d("2024-06-05") }),
      act({ id: "inact", isActive: false, plannedStart: d("2024-06-01"), plannedFinish: d("2024-06-05") }),
    ];
    const ids = runHealthChecks(activities, noEnvelope, asOf).map((i) => i.activityId);
    expect(ids).not.toContain("sum");
    expect(ids).not.toContain("inact");
  });

  it("returns nothing for an empty schedule", () => {
    expect(runHealthChecks([], noEnvelope, asOf)).toEqual([]);
  });

  it("orders errors before warnings", () => {
    const activities = [
      act({ id: "warn", plannedFinish: null }),
      act({ id: "err", actualFinish: d("2027-01-01") }),
    ];
    const issues = runHealthChecks(activities, noEnvelope, asOf);
    expect(issues[0].severity).toBe("error");
  });
});

describe("summarizeHealth", () => {
  it("counts errors, warnings, and issues per check", () => {
    const asOf = d("2026-06-19");
    const activities = [
      act({ id: "err", actualFinish: d("2027-01-01") }),
      act({ id: "warn", plannedFinish: null }),
    ];
    const summary = summarizeHealth(runHealthChecks(activities, { projectStart: null, projectFinish: null }, asOf));
    expect(summary.errors).toBe(1);
    expect(summary.warnings).toBe(1);
    expect(summary.byCheck.future_actual).toBe(1);
    expect(summary.byCheck.missing_dates).toBe(1);
  });
});

describe("summarizeProgress", () => {
  it("counts completed vs remaining leaf-active activities", () => {
    const activities: HealthActivity[] = [
      act({ id: "a", percentComplete: 100 }),
      act({ id: "b", percentComplete: 100 }),
      act({ id: "c", percentComplete: 50 }),
      act({ id: "d", percentComplete: null }),
      act({ id: "summary", type: "summary", percentComplete: 100 }), // excluded: not a leaf
      act({ id: "inactive", isActive: false, percentComplete: 100 }), // excluded: inactive
    ];
    expect(summarizeProgress(activities)).toEqual({ total: 4, completed: 2, remaining: 2, percentComplete: 50 });
  });

  it("returns zeros for an empty schedule", () => {
    expect(summarizeProgress([])).toEqual({ total: 0, completed: 0, remaining: 0, percentComplete: 0 });
  });
});
