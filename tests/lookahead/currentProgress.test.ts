import { describe, it, expect } from "vitest";
import { resolveCurrentProgress, carryProgressThroughSplits, type FinalizedEntry } from "@/lib/lookahead/currentProgress";

function entry(p: Partial<FinalizedEntry>): FinalizedEntry {
  return {
    canonicalActivityKey: "1|a", finalizedAt: new Date("2026-06-01T00:00:00Z"),
    status: "in_progress", actualStart: null, actualFinish: null, percentComplete: null, note: null, ...p,
  };
}

describe("resolveCurrentProgress", () => {
  it("keeps the latest finalized entry per key", () => {
    const map = resolveCurrentProgress([
      entry({ finalizedAt: new Date("2026-06-01T00:00:00Z"), percentComplete: 20 }),
      entry({ finalizedAt: new Date("2026-06-08T00:00:00Z"), percentComplete: 60 }),
    ]);
    expect(map.get("1|a")?.percentComplete).toBe(60);
  });
  it("resolves different keys independently", () => {
    const map = resolveCurrentProgress([
      entry({ canonicalActivityKey: "1|a", percentComplete: 10 }),
      entry({ canonicalActivityKey: "2|b", percentComplete: 90 }),
    ]);
    expect(map.get("1|a")?.percentComplete).toBe(10);
    expect(map.get("2|b")?.percentComplete).toBe(90);
  });
  it("returns an empty map for no entries", () => {
    expect(resolveCurrentProgress([]).size).toBe(0);
  });
});

describe("carryProgressThroughSplits", () => {
  const split = { coarseWbsCode: "3.2", coarseName: "Rough-In MEP", finerScopes: ["Rough Plumbing", "Rough Electrical"] };

  it("gives each finer activity the coarse activity's completed progress", () => {
    const done = entry({ canonicalActivityKey: "3.2|rough-in mep", status: "complete", percentComplete: 100, actualFinish: new Date("2026-06-05T00:00:00Z") });
    const map = resolveCurrentProgress(carryProgressThroughSplits([done], [split]));
    for (const key of ["3.2.1|rough plumbing", "3.2.2|rough electrical"]) {
      expect(map.get(key)).toMatchObject({ status: "complete", percentComplete: 100, actualFinish: done.actualFinish });
    }
  });

  it("lets a later entry on a finer activity win over the carried one", () => {
    const map = resolveCurrentProgress(carryProgressThroughSplits([
      entry({ canonicalActivityKey: "3.2|rough-in mep", percentComplete: 50 }),
      entry({ canonicalActivityKey: "3.2.1|rough plumbing", percentComplete: 90, finalizedAt: new Date("2026-06-08T00:00:00Z") }),
    ], [split]));
    expect(map.get("3.2.1|rough plumbing")?.percentComplete).toBe(90);
    expect(map.get("3.2.2|rough electrical")?.percentComplete).toBe(50);
  });
});

describe("forecast dates", () => {
  it("carry forward with the latest entry", () => {
    const f = new Date("2026-06-10T00:00:00Z");
    const map = resolveCurrentProgress([entry({ status: "not_started", forecastStart: f, forecastFinish: f })]);
    expect(map.get("1|a")).toMatchObject({ forecastStart: f, forecastFinish: f });
  });
});
