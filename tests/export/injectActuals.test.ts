import { describe, it, expect } from "vitest";
import { injectActuals, injectNames, type ProgressForExport } from "@/lib/export/injectActuals";

function doc() {
  return {
    Project: {
      Tasks: {
        Task: [
          { UID: "1", Name: "A", Start: "2025-06-03T08:00:00", Finish: "2025-06-03T17:00:00", PercentComplete: "0" },
          { UID: "2", Name: "B", Start: "2025-06-04T08:00:00", Finish: "2025-06-06T17:00:00", PercentComplete: "0" },
          { UID: "3", Name: "C", Start: "2025-06-07T08:00:00", Finish: "2025-06-08T17:00:00", PercentComplete: "0" },
        ],
      },
    },
  } as Record<string, unknown>;
}
function tasks(d: Record<string, unknown>) {
  return ((d.Project as any).Tasks.Task) as any[];
}
const prog = (p: Partial<ProgressForExport>): ProgressForExport => ({
  status: "in_progress", actualStart: null, actualFinish: null, percentComplete: null, ...p,
});

describe("injectActuals", () => {
  it("writes actual start and % for in-progress", () => {
    const d = doc();
    injectActuals(d, new Map([[1, prog({ status: "in_progress", actualStart: new Date("2026-06-16T00:00:00Z"), percentComplete: 50 })]]));
    expect(tasks(d)[0].ActualStart).toBe("2026-06-16T00:00:00");
    expect(tasks(d)[0].PercentComplete).toBe("50");
  });
  it("sets 100% and actual finish for complete, falling back to the task's own dates", () => {
    const d = doc();
    injectActuals(d, new Map([[2, prog({ status: "complete", actualStart: null, actualFinish: null })]]));
    expect(tasks(d)[1].PercentComplete).toBe("100");
    expect(tasks(d)[1].ActualFinish).toBe("2025-06-06T17:00:00"); // fell back to Finish
    expect(tasks(d)[1].ActualStart).toBe("2025-06-04T08:00:00");  // fell back to Start
  });
  it("leaves not_started tasks untouched", () => {
    const d = doc();
    injectActuals(d, new Map([[3, prog({ status: "not_started" })]]));
    expect(tasks(d)[2].ActualStart).toBeUndefined();
    expect(tasks(d)[2].PercentComplete).toBe("0");
  });
  it("touches only mapped tasks", () => {
    const d = doc();
    injectActuals(d, new Map([[1, prog({ status: "in_progress", actualStart: new Date("2026-06-16T00:00:00Z") })]]));
    expect(tasks(d)[1].ActualStart).toBeUndefined();
    expect(tasks(d)[2].ActualStart).toBeUndefined();
  });
  it("handles a single (non-array) Task node", () => {
    const d = { Project: { Tasks: { Task: { UID: "1", Name: "A", Start: "2025-06-03T08:00:00", Finish: "2025-06-03T17:00:00" } } } } as Record<string, unknown>;
    injectActuals(d, new Map([[1, prog({ status: "complete" })]]));
    expect(((d.Project as any).Tasks.Task).PercentComplete).toBe("100");
  });
});

describe("injectNames", () => {
  it("overwrites the Name of matched tasks only", () => {
    const d = doc();
    injectNames(d, new Map([[1, "Mobilization"]]));
    expect(tasks(d)[0].Name).toBe("Mobilization");
    expect(tasks(d)[1].Name).toBe("B");
    expect(tasks(d)[2].Name).toBe("C");
  });
  it("handles a single (non-array) Task node", () => {
    const d = { Project: { Tasks: { Task: { UID: "1", Name: "A" } } } } as Record<string, unknown>;
    injectNames(d, new Map([[1, "Renamed"]]));
    expect(((d.Project as any).Tasks.Task).Name).toBe("Renamed");
  });
});
