import { describe, it, expect } from "vitest";
import { phaseByActivityId } from "@/lib/os-context/activityPhase";

// Document order with outline levels: Phase 1 (L1) > Sitework (L2) > Excavate (L3 leaf)
const rows = [
  { id: "p1", outlineLevel: 1, outlineNumber: "1", name: "Phase 1" },
  { id: "site", outlineLevel: 2, outlineNumber: "1.1", name: "Sitework" },
  { id: "exc", outlineLevel: 3, outlineNumber: "1.1.1", name: "Excavate" },
  { id: "p2", outlineLevel: 1, outlineNumber: "2", name: "Phase 2" },
  { id: "elec", outlineLevel: 2, outlineNumber: "2.1", name: "Electrical" },
  { id: "wire", outlineLevel: 3, outlineNumber: "2.1.1", name: "Pull wire" },
];

describe("phaseByActivityId", () => {
  it("maps each activity to its top-level WBS group name", () => {
    const m = phaseByActivityId(rows);
    expect(m.get("exc")).toBe("Phase 1");
    expect(m.get("wire")).toBe("Phase 2");
    expect(m.get("elec")).toBe("Phase 2");
  });
  it("returns null for a top-level row with no ancestor", () => {
    expect(phaseByActivityId(rows).get("p1")).toBeNull();
  });
  it("sorts by outlineNumber before deriving, so input order does not matter", () => {
    const shuffled = [rows[5], rows[0], rows[2], rows[3], rows[1], rows[4]];
    expect(phaseByActivityId(shuffled).get("wire")).toBe("Phase 2");
  });
});
