import { describe, it, expect } from "vitest";
import { inheritedProgress } from "@/lib/completeness/acceptSplit";

const none = { durationMinutes: 2400, actualStart: null, actualFinish: null, actualDurationMinutes: null, remainingDurationMinutes: null, percentComplete: null, percentWorkComplete: null };

describe("inheritedProgress", () => {
  it("carries a completed coarse activity's dates and percent to its splits", () => {
    const start = new Date("2026-03-02T08:00:00Z");
    const finish = new Date("2026-03-09T17:00:00Z");
    const p = inheritedProgress({ ...none, actualStart: start, actualFinish: finish, actualDurationMinutes: 2400, remainingDurationMinutes: 0, percentComplete: 100 });
    expect(p).toMatchObject({ actualStart: start, actualFinish: finish, percentComplete: 100, remainingDurationMinutes: 0 });
  });
  it("leaves an unstarted activity unstarted with its full duration remaining", () => {
    expect(inheritedProgress(none)).toMatchObject({ actualStart: null, actualFinish: null, percentComplete: 0, remainingDurationMinutes: 2400 });
  });
});
