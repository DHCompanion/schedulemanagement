import { describe, it, expect } from "vitest";
import { assembleDraft } from "@/lib/baseline/draftBaseline";
import { draftToMspdi } from "@/lib/baseline/draftMspdi";
import { parseMspXml } from "@/lib/msp/parseMspXml";

describe("draftToMspdi", () => {
  it("writes a file our own importer reads back: tasks, durations, links, lags", () => {
    const draft = assembleDraft(
      [{ name: "Frame Walls", days: 5, typeN: 9 }, { name: "Tape & Bed", days: 3, typeN: 9 }],
      [{ from: "Frame Walls", to: "Tape & Bed", share: 0.8, base: 20, type: "SS", lagDays: 2 }],
      new Date("2025-03-03T00:00:00Z"),
    );
    const parsed = parseMspXml(draftToMspdi(draft, "Clinic draft"));
    expect(parsed.header.titleFromFile).toBe("Clinic draft");
    expect(parsed.header.minutesPerDay).toBe(480);
    const leaves = parsed.activities.filter((a) => !a.isProjectSummary);
    expect(leaves.map((a) => [a.name, a.isMilestone, a.durationMinutes])).toEqual([
      ["Start", true, 0], ["Frame Walls", false, 2400], ["Tape & Bed", false, 1440], ["Finish", true, 0],
    ]);
    const uid = (n: string) => leaves.find((a) => a.name === n)!.externalUid;
    expect(parsed.relationships).toContainEqual(expect.objectContaining({ predecessorExternalUid: uid("Frame Walls"), successorExternalUid: uid("Tape & Bed"), type: "SS", lagMinutes: 960 }));
    expect(leaves.find((a) => a.name === "Frame Walls")!.plannedStart).toBe("2025-03-03T08:00:00");
  });
});
