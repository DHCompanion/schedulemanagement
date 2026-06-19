import { describe, it, expect } from "vitest";
import { suggestScopes } from "@/lib/normalize/suggestScopes";

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
