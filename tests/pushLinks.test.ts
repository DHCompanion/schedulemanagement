import { describe, it, expect } from "vitest";
import { countPushesByDriver, connectorPath } from "../lib/schedule/pushLinks";

describe("countPushesByDriver", () => {
  it("counts, per driver uid, how many activities it pushes", () => {
    const counts = countPushesByDriver([
      { externalUid: 2, pushedByUid: 1 },
      { externalUid: 3, pushedByUid: 1 },
      { externalUid: 4, pushedByUid: 3 },
      { externalUid: 5, pushedByUid: null }, // not pushed → contributes nothing
    ]);
    expect(counts.get(1)).toBe(2); // uid 1 pushes 2 and 3
    expect(counts.get(3)).toBe(1); // uid 3 pushes 4
    expect(counts.get(5)).toBeUndefined();
    expect(counts.get(2)).toBeUndefined(); // pushed, but pushes nothing itself
  });
  it("returns an empty map when nothing is pushed", () => {
    expect(countPushesByDriver([{ externalUid: 1, pushedByUid: null }]).size).toBe(0);
  });
});

describe("connectorPath", () => {
  it("draws a cubic path from the driver point to the pushed point (endpoints preserved)", () => {
    const d = connectorPath({ x: 10, y: 20 }, { x: 100, y: 60 });
    expect(d.startsWith("M10,20")).toBe(true); // starts at the 'from' point
    expect(d.endsWith("100,60")).toBe(true); // ends at the 'to' point
    expect(d).toContain("C"); // is a cubic curve, not a straight segment
  });
});
