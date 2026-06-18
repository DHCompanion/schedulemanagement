import { describe, it, expect } from "vitest";
import { deriveParents } from "@/lib/msp/hierarchy";
import { canonicalActivityKey } from "@/lib/msp/canonicalKey";

describe("deriveParents", () => {
  it("derives parents from outline levels in document order", () => {
    const nodes = [
      { externalUid: 0, outlineLevel: 0 }, // project summary
      { externalUid: 1, outlineLevel: 1 }, // area  -> parent 0
      { externalUid: 2, outlineLevel: 2 }, // phase -> parent 1
      { externalUid: 3, outlineLevel: 3 }, // task  -> parent 2
      { externalUid: 4, outlineLevel: 3 }, // task  -> parent 2
      { externalUid: 5, outlineLevel: 2 }, // phase -> parent 1
    ];
    const parents = deriveParents(nodes);
    expect(parents.get(0)).toBeNull();
    expect(parents.get(1)).toBe(0);
    expect(parents.get(2)).toBe(1);
    expect(parents.get(3)).toBe(2);
    expect(parents.get(4)).toBe(2);
    expect(parents.get(5)).toBe(1);
  });
});

describe("canonicalActivityKey", () => {
  it("normalizes whitespace and case, keyed by wbs", () => {
    expect(canonicalActivityKey("1.2.3", "Electrical  Rough-In")).toBe("1.2.3|electrical rough-in");
    expect(canonicalActivityKey(null, "Foo")).toBe("|foo");
  });
});
