import { describe, it, expect } from "vitest";
import { phaseByActivityId, normalizePhase } from "@/lib/os-context/activityPhase";

describe("normalizePhase", () => {
  it("extracts the phase/area token from the band name", () => {
    expect(normalizePhase("Phase 1 - Patient Waiting")).toBe("1");
    expect(normalizePhase("Phase 2B - New Entrance")).toBe("2B");
    expect(normalizePhase("Area A - East Wing")).toBe("A");
    expect(normalizePhase("Phase 5")).toBe("5");
  });
});

describe("phaseByActivityId", () => {
  // Real-world shape: the phase band is nested at L3 under Construction, not at
  // the top level. Phase must be found by name, not by position.
  const rows = [
    { id: "root", outlineLevel: 1, outlineNumber: "1", name: "BSW Reno" },
    { id: "con", outlineLevel: 2, outlineNumber: "1.2", name: "Construction" },
    { id: "ph1", outlineLevel: 3, outlineNumber: "1.2.1", name: "Phase 1 - Patient Waiting" },
    { id: "e1", outlineLevel: 4, outlineNumber: "1.2.1.5", name: "Frame Walls" },
    { id: "ph2", outlineLevel: 3, outlineNumber: "1.2.2", name: "Phase 2 - ED Renovation" },
    { id: "e2", outlineLevel: 4, outlineNumber: "1.2.2.5", name: "Install Millwork" },
  ];

  it("finds the phase band by name at any depth and normalizes it", () => {
    const m = phaseByActivityId(rows);
    expect(m.get("e1")).toBe("1");
    expect(m.get("e2")).toBe("2");
  });

  it("returns null for a summary row that has no phase ancestor", () => {
    expect(phaseByActivityId(rows).get("con")).toBeNull();
    expect(phaseByActivityId(rows).get("root")).toBeNull();
  });

  it("outermost phase-named ancestor wins when phases nest", () => {
    const nested = [
      ...rows,
      { id: "proc", outlineLevel: 4, outlineNumber: "1.2.1.1", name: "Phase 1 Procurement" },
      { id: "x", outlineLevel: 5, outlineNumber: "1.2.1.1.1", name: "Order doors" },
    ];
    // "Phase 1 - Patient Waiting" (L3), not the inner "Phase 1 Procurement" (L4)
    expect(phaseByActivityId(nested).get("x")).toBe("1");
  });

  it("supports Area naming as an equivalent of phasing", () => {
    const areas = [
      { id: "p", outlineLevel: 1, outlineNumber: "1", name: "Project" },
      { id: "a", outlineLevel: 2, outlineNumber: "1.1", name: "Area A - North" },
      { id: "t", outlineLevel: 3, outlineNumber: "1.1.1", name: "Pour slab" },
    ];
    expect(phaseByActivityId(areas).get("t")).toBe("A");
  });

  it("returns null everywhere for an unphased project (no phase/area bands)", () => {
    const flat = [
      { id: "p", outlineLevel: 1, outlineNumber: "1", name: "Renovation" },
      { id: "s", outlineLevel: 2, outlineNumber: "1.1", name: "Sitework" },
      { id: "t", outlineLevel: 3, outlineNumber: "1.1.1", name: "Excavate" },
    ];
    const m = phaseByActivityId(flat);
    expect(m.get("t")).toBeNull();
    expect(m.get("s")).toBeNull();
  });

  it("finds phase bands at the top level too, and ignores input order", () => {
    const topLevel = [
      { id: "ph1", outlineLevel: 1, outlineNumber: "1", name: "Phase 1" },
      { id: "site", outlineLevel: 2, outlineNumber: "1.1", name: "Sitework" },
      { id: "exc", outlineLevel: 3, outlineNumber: "1.1.1", name: "Excavate" },
      { id: "ph2", outlineLevel: 1, outlineNumber: "2", name: "Phase 2" },
      { id: "wire", outlineLevel: 3, outlineNumber: "2.1.1", name: "Pull wire" },
      { id: "elec", outlineLevel: 2, outlineNumber: "2.1", name: "Electrical" },
    ];
    const m = phaseByActivityId(topLevel);
    expect(m.get("exc")).toBe("1");
    expect(m.get("wire")).toBe("2");
    expect(m.get("elec")).toBe("2");
  });
});
