import { describe, it, expect } from "vitest";
import { applyTradeDictionaryWith } from "@/lib/trades/applyTradeDictionary";

describe("applyTradeDictionaryWith", () => {
  it("splits mapped vs distinct unmapped scopes", () => {
    const dict = new Map([["Electrical Rough-In", "Electrical"]]);
    const res = applyTradeDictionaryWith(["Electrical Rough-In", "Electrical Rough-In", "Plumbing Top-Out"], dict);
    expect(res.mapped).toEqual([{ scope: "Electrical Rough-In", discipline: "Electrical" }]);
    expect(res.unmappedScopes).toEqual(["Plumbing Top-Out"]);
  });
});
