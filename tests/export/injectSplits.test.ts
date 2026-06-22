import { describe, it, expect } from "vitest";
import { injectSplits, type SplitForExport } from "@/lib/export/injectSplits";

function doc() {
  return {
    Project: {
      Tasks: {
        Task: [
          { UID: "1", Name: "Predecessor", WBS: "1", OutlineNumber: "1", OutlineLevel: "1" },
          {
            UID: "2", Name: "Drywall", WBS: "2", OutlineNumber: "2", OutlineLevel: "1",
            Start: "2026-03-02T08:00:00", Finish: "2026-03-09T17:00:00", Duration: "PT2400M0S",
            PredecessorLink: { PredecessorUID: "1", Type: "1", LinkLag: "0", LagFormat: "7" },
          },
          {
            UID: "3", Name: "Successor", WBS: "3", OutlineNumber: "3", OutlineLevel: "1",
            PredecessorLink: { PredecessorUID: "2", Type: "1", LinkLag: "0", LagFormat: "7" },
          },
        ],
      },
    },
  } as Record<string, unknown>;
}
function tasks(d: Record<string, unknown>) {
  return ((d.Project as any).Tasks.Task) as any[];
}

const split: SplitForExport = {
  coarseExternalUid: 2,
  coarseWbsCode: "2",
  coarseOutlineNumber: "2",
  coarseOutlineLevel: 1,
  coarseDurationMinutes: 2400,
  coarseStart: new Date("2026-03-02T08:00:00Z"),
  coarseFinish: new Date("2026-03-09T17:00:00Z"),
  finerScopes: ["Drywall Hang", "Drywall Tape"],
  mintedUids: [101, 102],
};

describe("injectSplits", () => {
  it("replaces the coarse task with N parallel splits, fanning predecessors out and successors in", () => {
    const d = doc();
    injectSplits(d, [split]);
    const ts = tasks(d);
    expect(ts.map((t) => t.UID)).toEqual(["1", "101", "102", "3"]);

    const hang = ts.find((t) => t.UID === "101");
    expect(hang.Name).toBe("Drywall Hang");
    expect(hang.WBS).toBe("2.1");
    expect(hang.OutlineNumber).toBe("2.1");
    expect(hang.OutlineLevel).toBe("1");
    expect(hang.Start).toBe("2026-03-02T08:00:00");
    expect(hang.Finish).toBe("2026-03-09T17:00:00");
    expect(hang.Duration).toBe("PT40H0M0S");
    expect(hang.PredecessorLink).toEqual({ PredecessorUID: "1", Type: "1", LinkLag: "0", LagFormat: "7" });

    const tape = ts.find((t) => t.UID === "102");
    expect(tape.WBS).toBe("2.2");
    expect(tape.PredecessorLink).toEqual({ PredecessorUID: "1", Type: "1", LinkLag: "0", LagFormat: "7" });

    const successor = ts.find((t) => t.UID === "3");
    expect(successor.PredecessorLink).toEqual([
      { PredecessorUID: "101", Type: "1", LinkLag: "0", LagFormat: "7" },
      { PredecessorUID: "102", Type: "1", LinkLag: "0", LagFormat: "7" },
    ]);
  });

  it("leaves the document untouched when the coarse UID isn't found", () => {
    const d = doc();
    injectSplits(d, [{ ...split, coarseExternalUid: 999 }]);
    expect(tasks(d).map((t) => t.UID)).toEqual(["1", "2", "3"]);
  });

  it("applies multiple splits in the same document", () => {
    const d = doc();
    const split2: SplitForExport = { ...split, coarseExternalUid: 1, coarseWbsCode: "1", coarseOutlineNumber: "1", finerScopes: ["Mob A"], mintedUids: [201] };
    injectSplits(d, [split2, split]);
    expect(tasks(d).map((t) => t.UID)).toEqual(["201", "101", "102", "3"]);
  });
});
