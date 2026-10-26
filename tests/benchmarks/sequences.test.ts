import { describe, it, expect } from "vitest";
import { aggregateFacts, blendShare, scheduleFacts, type ProjectFacts } from "@/lib/benchmarks/benchmarks";

const a = (externalUid: number, name: string, isCritical = false, over = {}) => ({
  externalUid, name, isCritical, type: "task", isActive: true, isMilestone: false,
  plannedStart: null, plannedFinish: null, actualStart: null, actualFinish: null, ...over,
});
const link = (p: number, s: number, type = "FS", lagMinutes: number | null = null) => ({ predecessorExternalUid: p, successorExternalUid: s, type, lagMinutes, crossProject: false });
const dict = new Map([["frame l1", "Frame Walls"], ["frame l2", "Frame Walls"], ["hang", "Install Sheetrock"], ["tape", "Tape and Bed"]]);

describe("scheduleFacts", () => {
  it("follows links through activities with no standard name", () => {
    const facts = scheduleFacts(
      [a(1, "Frame L1"), a(2, "Inspection", false, { isMilestone: true }), a(3, "Unmapped"), a(4, "Hang"), a(5, "Tape")],
      [link(1, 2, "SS", 480), link(2, 3), link(3, 4), link(4, 5), link(3, 1)],
      dict, 480,
    );
    expect(Object.fromEntries(facts.pairs)).toEqual({
      [JSON.stringify(["Frame Walls", "Install Sheetrock"])]: { type: "FS", lagDays: 0 },
      [JSON.stringify(["Install Sheetrock", "Tape and Bed"])]: { type: "FS", lagDays: 0 },
    });
  });

  it("collects names, critical names and direct links between different names", () => {
    const facts = scheduleFacts(
      [a(1, "Frame L1", true), a(2, "Frame L2"), a(3, "Hang"), a(4, "Tape"), a(5, "Unmapped"), a(6, "Hang", true, { type: "summary" })],
      [link(1, 2), link(1, 3, "FS", 960), link(2, 3, "SS", 0), link(2, 3, "SS", 480), link(3, 5), link(3, 4, "FS", null)],
      dict, 480,
    );
    expect([...facts.scopes].sort()).toEqual(["Frame Walls", "Install Sheetrock", "Tape and Bed"]);
    expect([...facts.critical]).toEqual(["Frame Walls"]);
    // Frame→Frame is a self-link; Hang→Unmapped has no name. Frame→Hang: types FS, SS, SS → SS; lags 2, 0, 1 days → 1.
    expect(Object.fromEntries(facts.pairs)).toEqual({
      [JSON.stringify(["Frame Walls", "Install Sheetrock"])]: { type: "SS", lagDays: 1 },
      [JSON.stringify(["Install Sheetrock", "Tape and Bed"])]: { type: "FS", lagDays: 0 },
    });
  });
});

describe("aggregateFacts", () => {
  const key = JSON.stringify(["Frame Walls", "Install Sheetrock"]);
  const fact = (buildingType: string | null, scopes: string[], critical: string[], linked: boolean): ProjectFacts => ({
    sector: "Healthcare", buildingType, scopes: new Set(scopes), critical: new Set(critical),
    pairs: new Map(linked ? [[key, { type: "FS", lagDays: 2 }]] : []),
  });
  it("counts criticality and links per sector and building type, against projects that have both names", () => {
    const { criticality, sequences, groups } = aggregateFacts([
      fact("Clinic", ["Frame Walls", "Install Sheetrock"], ["Frame Walls"], true),
      fact("Clinic", ["Frame Walls", "Install Sheetrock"], [], true),
      fact("OR Suite", ["Frame Walls", "Install Sheetrock"], ["Frame Walls"], false),
      fact(null, ["Frame Walls"], ["Frame Walls"], false),
    ]);
    expect(criticality).toContainEqual({ canonicalScope: "Frame Walls", groupKind: "sector", groupValue: "Healthcare", n: 4, critical: 3 });
    expect(criticality).toContainEqual({ canonicalScope: "Frame Walls", groupKind: "buildingType", groupValue: "Clinic", n: 2, critical: 1 });
    expect(sequences).toContainEqual({ fromScope: "Frame Walls", toScope: "Install Sheetrock", groupKind: "sector", groupValue: "Healthcare", projects: 2, base: 3, type: "FS", lagDays: 2 });
    expect(groups).toContainEqual({ groupKind: "sector", groupValue: "Healthcare", projects: 4 });
    expect(groups).toContainEqual({ groupKind: "buildingType", groupValue: "Clinic", projects: 2 });
    // OR Suite has both names but never links them: its row records 0 of 1, pulling the blended share down.
    expect(sequences).toContainEqual({ fromScope: "Frame Walls", toScope: "Install Sheetrock", groupKind: "buildingType", groupValue: "OR Suite", projects: 0, base: 1, type: "FS", lagDays: 0 });
    // A link seen in only one project of a sector isn't kept at all.
    const lone = aggregateFacts([fact("Clinic", ["Frame Walls", "Install Sheetrock"], [], true)]).sequences;
    expect(lone).toEqual([]);
  });

  it("counts subtype groups the way it counts building types", () => {
    const ir = (linked: boolean): ProjectFacts => ({ ...fact("Special Procedure (EP, Cath, IR)", ["Frame Walls", "Install Sheetrock"], ["Frame Walls"], linked), subType: "IR" });
    const { criticality, sequences, groups } = aggregateFacts([ir(true), ir(false), fact("Clinic", ["Frame Walls", "Install Sheetrock"], [], true)]);
    const groupValue = "Special Procedure (EP, Cath, IR) / IR";
    expect(groups).toContainEqual({ groupKind: "subType", groupValue, projects: 2 });
    expect(criticality).toContainEqual({ canonicalScope: "Frame Walls", groupKind: "subType", groupValue, n: 2, critical: 2 });
    expect(sequences).toContainEqual({ fromScope: "Frame Walls", toScope: "Install Sheetrock", groupKind: "subType", groupValue, projects: 1, base: 2, type: "FS", lagDays: 2 });
  });
});

describe("blendShare", () => {
  it("shrinks the building type's share toward the sector's, and needs 5 sector projects", () => {
    const b = blendShare({ n: 20, share: 0.4 }, { n: 5, share: 0.8 });
    expect(b?.share).toBeCloseTo(0.6);
    expect(b).toMatchObject({ n: 20, typeN: 5 });
    expect(blendShare({ n: 20, share: 0.4 }, undefined)).toEqual({ share: 0.4, n: 20, typeN: 0 });
    expect(blendShare({ n: 4, share: 1 }, undefined)).toBeNull();
    // Then the subtype by n / (n + 2): 2 projects at 1.0 against 0.6 → 0.8.
    expect(blendShare({ n: 20, share: 0.4 }, { n: 5, share: 0.8 }, { n: 2, share: 1 })?.share).toBeCloseTo(0.8);
  });
});
