import { describe, it, expect } from "vitest";
import { mapRelationshipType } from "@/lib/msp/relationshipType";

describe("mapRelationshipType", () => {
  it("maps MSPDI codes", () => {
    expect(mapRelationshipType("0")).toBe("FF");
    expect(mapRelationshipType("1")).toBe("FS");
    expect(mapRelationshipType("2")).toBe("SF");
    expect(mapRelationshipType("3")).toBe("SS");
    expect(mapRelationshipType(1)).toBe("FS");
  });
  it("defaults unknown/missing to FS", () => {
    expect(mapRelationshipType(null)).toBe("FS");
    expect(mapRelationshipType("9")).toBe("FS");
  });
});
