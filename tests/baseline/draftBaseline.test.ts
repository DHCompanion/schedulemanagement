import { describe, it, expect } from "vitest";
import { assembleDraft, type DraftLink } from "@/lib/baseline/draftBaseline";

const start = new Date("2025-03-03T00:00:00Z"); // a Monday
const scope = (name: string, days: number | null, typeN = 5, n = 20) => ({ name, days, typeN, n });
const link = (from: string, to: string, share = 0.8, type: DraftLink["type"] = "FS", lagDays = 0, base = 10): DraftLink => ({ from, to, share, base, type, lagDays });
const day = (d: Date) => d.toISOString().slice(0, 10);
const byName = (draft: ReturnType<typeof assembleDraft>) => new Map(draft.activities.map((a) => [a.name, a]));

describe("assembleDraft", () => {
  it("keeps a name with under 5 projects behind it, flagged thin, and leaves out one with none", () => {
    const draft = assembleDraft([scope("Install MRI Equipment", 18, 3, 3), scope("Ramp Down MRI", null, 0, 0), scope("Frame", 4)], [], start);
    expect(byName(draft).get("Install MRI Equipment")).toMatchObject({ days: 18, lowConfidence: true });
    expect(draft.warnings).toContain("Install MRI Equipment: only 3 projects, duration is a rough guess.");
    expect(draft.warnings).toContain("Ramp Down MRI: no duration data, left out.");
    expect(draft.warnings.some((w) => w.includes("lean on the sector"))).toBe(false);
  });

  it("puts waiting-period names in as milestones, with or without duration data", () => {
    const draft = assembleDraft(
      [scope("Frame", 5), scope("Permit Issued", 25.5), scope("Notice to Proceed", null, 0, 0), scope("Hang", 3), scope("Paint", 2), scope("Turnover", 9)],
      [link("Frame", "Permit Issued"), link("Permit Issued", "Hang"), link("Hang", "Paint"), link("Paint", "Turnover", 0.8, "SS")],
      start,
    );
    const a = byName(draft);
    // Frame Mon 3 – Fri 7; the permit opens Mon 10, Hang with it; Paint Thu 13; Turnover SS on Paint's start.
    expect(a.get("Permit Issued")).toMatchObject({ days: 0, milestone: true });
    expect([a.get("Permit Issued")!.start, a.get("Permit Issued")!.finish].map((d) => d.toISOString())).toEqual(["2025-03-10T08:00:00.000Z", "2025-03-10T08:00:00.000Z"]);
    expect(day(a.get("Hang")!.start)).toBe("2025-03-10");
    expect(a.get("Turnover")!.start.getTime()).toBe(a.get("Paint")!.start.getTime());
    expect(a.get("Notice to Proceed")).toMatchObject({ days: 0, milestone: true });
    expect(draft.warnings.some((w) => w.startsWith("Notice to Proceed") || w.startsWith("Permit Issued"))).toBe(false);
  });

  it("keeps Finish no earlier than a closing milestone", () => {
    const draft = assembleDraft([scope("Frame", 5), scope("Turnover", 1)], [link("Frame", "Turnover")], start);
    // Frame Mon 3 – Fri 7; Turnover Mon 10 08:00, the same working moment as Fri 17:00.
    expect(byName(draft).get("Finish")!.start.getTime()).toBe(byName(draft).get("Turnover")!.start.getTime());
    expect(draft.workingDays).toBe(5);
  });

  it("schedules FS and SS links forward from the start milestone, P75 rounded up, and ties ends to a finish milestone", () => {
    const draft = assembleDraft([scope("Frame", 4.2), scope("Hang", 3), scope("Layout", 2)], [link("Frame", "Hang"), link("Frame", "Layout", 0.6, "SS", 1)], start);
    const a = byName(draft);
    // Frame: 5 days Mon 3 – Fri 7; Hang FS: Mon 10 – Wed 12; Layout SS+1: Tue 4 – Wed 5.
    expect([day(a.get("Frame")!.start), day(a.get("Frame")!.finish), a.get("Frame")!.days]).toEqual(["2025-03-03", "2025-03-07", 5]);
    expect([day(a.get("Hang")!.start), day(a.get("Hang")!.finish)]).toEqual(["2025-03-10", "2025-03-12"]);
    expect([day(a.get("Layout")!.start), day(a.get("Layout")!.finish)]).toEqual(["2025-03-04", "2025-03-05"]);
    expect(draft.activities[0]).toMatchObject({ name: "Start", milestone: true, preds: [] });
    const finish = draft.activities.at(-1)!;
    expect(finish).toMatchObject({ name: "Finish", milestone: true });
    expect(day(finish.start)).toBe("2025-03-12");
    // Open ends tie to the milestones: Frame starts from Start; Hang and Layout lead to Finish.
    const uid = (n: string) => a.get(n)!.uid;
    expect(a.get("Frame")!.preds).toEqual([{ uid: 1, type: "FS", lagDays: 0, weak: false }]);
    expect(finish.preds.map((p) => p.uid).sort()).toEqual([uid("Hang"), uid("Layout")].sort());
  });

  it("ties an activity whose only successors are SS to the finish milestone", () => {
    const draft = assembleDraft([scope("A", 5), scope("B", 1)], [link("A", "B", 0.9, "SS")], start);
    expect(draft.activities.at(-1)!.preds.map((p) => p.uid).sort()).toEqual([2, 3]);
  });

  it("adds a weaker link only where an activity has no link most projects agree on", () => {
    // B has no strong link either way: its commonest predecessor (A → B, 30%) and successor (B → C, 20%) come in as weak.
    // C → B (10%) isn't B's commonest anything, so it stays out.
    const draft = assembleDraft([scope("A", 2), scope("B", 2), scope("C", 2)], [link("A", "C", 0.9), link("A", "B", 0.3), link("B", "C", 0.2), link("C", "B", 0.1)], start);
    const a = byName(draft);
    expect(a.get("B")!.preds).toEqual([{ uid: a.get("A")!.uid, type: "FS", lagDays: 0, weak: true }]);
    expect(a.get("C")!.preds).toEqual([{ uid: a.get("A")!.uid, type: "FS", lagDays: 0, weak: false }, { uid: a.get("B")!.uid, type: "FS", lagDays: 0, weak: true }]);
    expect(draft.warnings).toContain("2 links are an activity's commonest neighbour but used by under half the projects.");
  });

  it("aligns finishes on an FF link", () => {
    const a = byName(assembleDraft([scope("A", 5), scope("B", 2)], [link("A", "B", 0.9, "FF")], start));
    expect(day(a.get("B")!.finish)).toBe(day(a.get("A")!.finish));
  });

  it("finishes an SF successor by the predecessor's start", () => {
    // B (3 days) SS+2 after A puts it Wed–Fri; C (2 days) SF from B must finish by Wed's start: Mon–Tue.
    const a = byName(assembleDraft([scope("A", 5), scope("B", 3), scope("C", 2)], [link("A", "B", 0.9, "SS", 2), link("B", "C", 0.9, "SF")], start));
    expect([day(a.get("C")!.start), day(a.get("C")!.finish)]).toEqual(["2025-03-03", "2025-03-04"]);
  });

  it("ties to Finish any activity that outlasts its successors", () => {
    // FS −9 starts B on A's second day, so B ends 8 days before A: A must still hold up Finish.
    const draft = assembleDraft([scope("A", 10), scope("B", 1)], [link("A", "B", 0.9, "FS", -9)], start);
    expect(draft.activities.at(-1)!.preds.map((p) => p.uid).sort()).toEqual([2, 3]);
  });

  it("breaks a loop by dropping its weakest link, and says so", () => {
    const draft = assembleDraft([scope("A", 1), scope("B", 1), scope("C", 1)], [link("A", "B", 0.9), link("B", "C", 0.8), link("C", "A", 0.6)], start);
    expect(draft.warnings).toContain("Dropped C → A to break a loop.");
    expect(byName(draft).get("A")!.preds).toEqual([{ uid: 1, type: "FS", lagDays: 0, weak: false }]);
  });

  it("leaves out names with no duration data and flags thin ones", () => {
    const draft = assembleDraft([scope("A", 2), scope("Rare", null), scope("Thin", 3, 1)], [], start);
    expect(draft.activities.map((a) => a.name)).toEqual(["Start", "A", "Thin", "Finish"]);
    expect(draft.warnings).toContain("Rare: no duration data, left out.");
    expect(byName(draft).get("Thin")!.lowConfidence).toBe(true);
    expect(byName(draft).get("A")!.lowConfidence).toBe(false);
    expect(draft.warnings).toContain("1 of 2 durations lean on the sector (fewer than 5 projects of this type).");
  });

  it("warns about links that rest on few projects", () => {
    expect(assembleDraft([scope("A", 1), scope("B", 1)], [link("A", "B", 1, "FS", 0, 2)], start).warnings).toContain("1 link rests on fewer than 5 projects.");
  });
});
