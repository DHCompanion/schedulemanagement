import { describe, it, expect } from "vitest";
import { entryProblem } from "@/lib/updates/updateService";
import type { EntryInput } from "@/lib/updates/updateService";

const activity = { externalUid: 7, canonicalActivityKey: "1.1|hang drywall" };
const base: EntryInput = {
  activityExternalUid: 7, canonicalActivityKey: "1.1|hang drywall", status: "in_progress",
  actualStart: "2026-08-01", actualFinish: null, percentComplete: 40, note: null, expectedVersion: null,
};

describe("entryProblem", () => {
  it("accepts a valid entry", () => {
    expect(entryProblem(base, activity)).toBeNull();
    expect(entryProblem({ ...base, status: "complete", actualFinish: "2026-08-05", percentComplete: 100 }, activity)).toBeNull();
    expect(entryProblem({ ...base, status: "not_started", actualStart: null, percentComplete: null }, activity)).toBeNull();
  });

  it.each([
    [{ status: "done" }, /status/],
    [{ percentComplete: 101 }, /0–100/],
    [{ percentComplete: -1 }, /0–100/],
    [{ percentComplete: 12.5 }, /0–100/],
    [{ actualStart: null }, /actual start/],
    [{ status: "complete", actualFinish: null, percentComplete: 100 }, /actual finish/],
    [{ status: "complete", actualStart: "2026-08-05", actualFinish: "2026-08-01", percentComplete: 100 }, /before/],
    [{ actualStart: "not-a-date" }, /date/],
    [{ forecastStart: "2026-13-40" }, /date/],
    [{ expectedVersion: undefined }, /Reload/],
  ] as [Partial<EntryInput>, RegExp][])("refuses %o", (patch, message) => {
    expect(entryProblem({ ...base, ...patch }, activity)).toMatch(message);
  });

  it("refuses an activity that is not in the draft's schedule import", () => {
    expect(entryProblem(base, undefined)).toMatch(/not in this update's schedule/);
    expect(entryProblem({ ...base, activityExternalUid: 8 }, activity)).toMatch(/not in this update's schedule/);
  });
});
