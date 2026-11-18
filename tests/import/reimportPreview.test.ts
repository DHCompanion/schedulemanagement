import { describe, it, expect } from "vitest";
import { summarizeReimport } from "@/lib/import/reimportPreview";

const act = (externalUid: number, wbsCode: string, name: string, type = "task") => ({
  externalUid, externalId: externalUid, wbsCode, name, type, isActive: true,
  canonicalActivityKey: `${wbsCode}|${name.toLowerCase()}`,
});

describe("summarizeReimport", () => {
  const rules = new Map([["Finishes", ["Paint", "Flooring"]], ["MEP Rough", ["Electrical Rough", "Plumbing Rough"]]]);
  const dictionary = new Map([["paint", "Paint"], ["finishes", "Finishes"], ["finish work", "Finishes"], ["mep rough", "MEP Rough"], ["demo", "Demolition"]]);

  it("lists only the coarse scopes this project split before, counted in the new file", () => {
    const summary = summarizeReimport({
      activities: [act(1, "1.1", "Finishes"), act(2, "1.2", "Finish Work"), act(3, "1.3", "MEP Rough"), act(4, "1.4", "Demo")],
      splitRules: rules,
      dictionary,
      settledNames: new Set(),
      progressKeys: [],
      previousSplitNames: ["finishes"],
    });
    expect(summary.resplit).toEqual([{ coarseScope: "Finishes", count: 2 }]);
  });

  it("lists leaf names that are neither in the dictionary nor settled, once each", () => {
    const summary = summarizeReimport({
      activities: [act(1, "1", "Phase 3", "summary"), act(2, "1.1", "Demo"), act(3, "1.2", "Temp Walls"), act(4, "1.3", "temp  walls"), act(5, "1.4", "Owner Move")],
      splitRules: rules,
      dictionary,
      settledNames: new Set(["owner move"]),
      progressKeys: [],
      previousSplitNames: [],
    });
    expect(summary.newNames).toEqual(["Temp Walls"]);
  });

  it("reports progress whose key the new file lacks, counting the keys a re-split will mint", () => {
    const summary = summarizeReimport({
      activities: [act(1, "1.1", "Demo"), act(2, "1.5", "Finishes")],
      splitRules: rules,
      dictionary,
      settledNames: new Set(),
      // 1.1 Demo is still there; 1.5.1/1.5.2 come back when Finishes is re-split; 1.3 moved away.
      progressKeys: ["1.1|demo", "1.5.1|paint", "1.5.2|flooring", "1.3|demo", "2.1|paint"],
      previousSplitNames: ["Finishes"],
    });
    expect(summary.orphanedProgress).toEqual(["1.3|demo", "2.1|paint"]);
    // Only found again if the split is re-applied: lost when the box is unticked.
    expect(summary.progressNeedingResplit).toEqual(["1.5.1|paint", "1.5.2|flooring"]);
  });

  it("leaves a dismissed activity coarse, as the commit's re-split will", () => {
    const summary = summarizeReimport({
      activities: [act(1, "1.5", "Finishes"), act(2, "1.6", "Finishes")],
      splitRules: rules,
      dictionary,
      settledNames: new Set(),
      progressKeys: ["1.5.1|paint", "1.6.1|paint"],
      previousSplitNames: ["Finishes"],
      dismissed: new Set(["1.6|finishes::Finishes"]),
    });
    expect(summary.resplit).toEqual([{ coarseScope: "Finishes", count: 1 }]);
    expect(summary.orphanedProgress).toEqual(["1.6.1|paint"]);
  });
});
