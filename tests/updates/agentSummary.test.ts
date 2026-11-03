import { describe, it, expect } from "vitest";
import { agentSummary } from "@/lib/updates/agentSummary";

const saved = (activities: string[]) => ({ result: { saved: true, asOfDate: "2026-11-03", activities, reason: null, message: null } });

describe("agentSummary", () => {
  it("lists each activity the agent saved once, ignoring refused writes", () => {
    const rows = [saved(["1|a", "2|b"]), { result: { saved: false, asOfDate: null, activities: ["3|c"], reason: "stale", message: "x" } }, saved(["2|b"]), saved([])];
    expect(agentSummary(rows)).toEqual(["1|a", "2|b"]);
  });
  it("is empty with no agent writes or malformed results", () => {
    expect(agentSummary([])).toEqual([]);
    expect(agentSummary([{ result: null }, { result: { saved: true, activities: "1|a" } }])).toEqual([]);
  });
});
