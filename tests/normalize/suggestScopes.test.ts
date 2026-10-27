import { describe, it, expect } from "vitest";
import { bestMatch, suggestScopes } from "@/lib/normalize/suggestScopes";

describe("suggestScopes", () => {
  it("ranks higher token overlap first and drops zero-overlap scopes", () => {
    const out = suggestScopes("Electrical Rough In", ["Electrical Rough In", "Electrical", "Concrete Slab"]);
    expect(out[0]).toBe("Electrical Rough In");
    expect(out).toContain("Electrical");
    expect(out).not.toContain("Concrete Slab");
  });
  it("respects the limit", () => {
    const out = suggestScopes("rough in work", ["rough in a", "rough in b", "rough in c"], 2);
    expect(out.length).toBe(2);
  });
  it("returns empty for no known scopes", () => {
    expect(suggestScopes("anything", [])).toEqual([]);
  });
});

describe("suggestScopes with mapped names", () => {
  it("learns from names already mapped, through abbreviations", () => {
    const mapped = new Map([["layout overhead electrical", "Electrical Overhead Rough-In"]]);
    expect(suggestScopes("Layout OH Electrical", ["Electrical Overhead Rough-In", "Layout"], 1, mapped)).toEqual(["Electrical Overhead Rough-In"]);
  });
  it("expands demo, elec and plurals", () => {
    expect(suggestScopes("Demo Drywall", ["Demolish Drywall", "Install Drywall"], 1)).toEqual(["Demolish Drywall"]);
    expect(suggestScopes("Elec Trimout", ["Electrical Trim Out", "Plumbing Trim Out"], 1)).toEqual(["Electrical Trim Out"]);
    expect(suggestScopes("Install Doors", ["Install Door", "Install Doorbell"], 1)).toEqual(["Install Door"]);
  });
});

describe("bestMatch", () => {
  it("scores the top suggestion so callers can grade confidence", () => {
    expect(bestMatch("Install Door", ["Install Door"])).toEqual({ scope: "Install Door", score: 1 });
    expect(bestMatch("Mobilize", ["Install Door"])).toBeNull();
  });
});
