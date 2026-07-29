import { describe, it, expect } from "vitest";
import { resolveActivityTradesWith } from "@/lib/trades/activityTrades";
import type { OsDiscipline, ProjectAssignment } from "@/lib/trades/tradesService";

const scopeDict = new Map([["hang drywall l2", "Hang Drywall"]]);
const tradeDict = new Map<string, OsDiscipline>([
  ["Hang Drywall", { id: 9, name: "09A: DRYWALL/ACOUSTICAL", division: "" }],
]);
const assignments = new Map<number, ProjectAssignment>([
  [9, { osPartnerId: 4, name: "Carrco Painting Contractors, Inc.", onRoster: true }],
]);

describe("resolveActivityTradesWith", () => {
  it("resolves name to discipline and partner", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "Hang Drywall L2" }], scopeDict, tradeDict, assignments);
    expect(out.get("a1")).toEqual({
      disciplineName: "09A: DRYWALL/ACOUSTICAL",
      partnerName: "Carrco Painting Contractors, Inc.",
    });
  });

  it("omits an activity whose name is not in the scope dictionary", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "Mystery Task" }], scopeDict, tradeDict, assignments);
    expect(out.has("a1")).toBe(false);
  });

  it("omits an activity whose scope has no discipline", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "Hang Drywall L2" }], scopeDict, new Map(), assignments);
    expect(out.has("a1")).toBe(false);
  });

  it("returns the discipline with a null partner when none is assigned", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "Hang Drywall L2" }], scopeDict, tradeDict, new Map());
    expect(out.get("a1")).toEqual({ disciplineName: "09A: DRYWALL/ACOUSTICAL", partnerName: null });
  });

  it("matches names case- and whitespace-insensitively", () => {
    const out = resolveActivityTradesWith([{ id: "a1", name: "  HANG   drywall l2 " }], scopeDict, tradeDict, assignments);
    expect(out.get("a1")?.partnerName).toBe("Carrco Painting Contractors, Inc.");
  });
});
