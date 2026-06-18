import { describe, it, expect } from "vitest";
import { resolveCurrentProgress, type FinalizedEntry } from "@/lib/lookahead/currentProgress";

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
