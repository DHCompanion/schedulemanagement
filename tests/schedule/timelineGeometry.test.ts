import { describe, it, expect } from "vitest";
import { resolveWindow, spanPct, pointPct, axisTicks, weekendBands, gridLines } from "@/lib/schedule/timelineGeometry";

const today = new Date("2026-08-05T12:00:00Z"); // Wed; week starts Mon Aug 3

describe("resolveWindow", () => {
  it("3wk and 6wk start at this week's Monday and span exactly N weeks", () => {
    const w3 = resolveWindow("3wk", [], today);
    expect(new Date(w3.startMs).toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect((w3.endMs - w3.startMs) / 86_400_000).toBe(21);
    const w6 = resolveWindow("6wk", [], today);
    expect((w6.endMs - w6.startMs) / 86_400_000).toBe(42);
  });
  it("full spans min..max of the given dates with padding", () => {
    const w = resolveWindow("full", ["2026-08-03T08:00:00Z", null, "2026-10-30T17:00:00Z"], today);
    expect(w.startMs).toBeLessThan(Date.parse("2026-08-03T08:00:00Z"));
    expect(w.endMs).toBeGreaterThan(Date.parse("2026-10-30T17:00:00Z"));
  });
  it("full with no dates falls back to a four-week window", () => {
    const w = resolveWindow("full", [null], today);
    expect((w.endMs - w.startMs) / 86_400_000).toBe(28);
  });
});

describe("spanPct", () => {
  const win = { startMs: Date.parse("2026-08-03T00:00:00Z"), endMs: Date.parse("2026-08-17T00:00:00Z") }; // 14 days
  it("positions a span as percentages of the window", () => {
    const p = spanPct("2026-08-04T00:00:00Z", "2026-08-11T00:00:00Z", win)!;
    expect(p.leftPct).toBeCloseTo((1 / 14) * 100, 5);
    expect(p.widthPct).toBeCloseTo((7 / 14) * 100, 5);
  });
  it("clamps spans that overflow the window", () => {
    const p = spanPct("2026-07-01T00:00:00Z", "2026-09-01T00:00:00Z", win)!;
    expect(p.leftPct).toBe(0);
    expect(p.widthPct).toBeCloseTo(100, 5);
  });
  it("returns null fully outside and enforces a minimum visible width", () => {
    expect(spanPct("2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z", win)).toBeNull();
    expect(spanPct(null, null, win)).toBeNull();
    const sliver = spanPct("2026-08-04T00:00:00Z", "2026-08-04T00:30:00Z", win)!;
    expect(sliver.widthPct).toBeGreaterThanOrEqual(0.5);
  });
});

describe("pointPct", () => {
  const win = { startMs: Date.parse("2026-08-03T00:00:00Z"), endMs: Date.parse("2026-08-17T00:00:00Z") };
  it("positions a point and nulls outside", () => {
    expect(pointPct("2026-08-10T00:00:00Z", win)).toBeCloseTo(50, 5);
    expect(pointPct("2026-09-01T00:00:00Z", win)).toBeNull();
    expect(pointPct(null, win)).toBeNull();
  });
});

describe("gridLines", () => {
  it("draws one line per UTC midnight in a windowed view, Mondays major", () => {
    const win = { startMs: Date.parse("2026-08-03T00:00:00Z"), endMs: Date.parse("2026-08-24T00:00:00Z") }; // 3wk from a Monday
    const lines = gridLines(win);
    expect(lines.length).toBe(20); // Aug 4 .. Aug 23 midnights
    expect(lines.filter((l) => l.isMajor).length).toBe(2); // Mon Aug 10, Mon Aug 17
  });
  it("falls back to tick positions past 45 days", () => {
    const win = { startMs: Date.parse("2026-01-01T00:00:00Z"), endMs: Date.parse("2026-06-30T00:00:00Z") };
    const lines = gridLines(win);
    expect(lines.length).toBe(axisTicks(win).length);
    expect(lines.every((l) => l.isMajor)).toBe(true);
  });
});

describe("axis", () => {
  it("labels every day m/d, centered over the day, in a 3-week window", () => {
    const win = { startMs: Date.parse("2026-08-03T00:00:00Z"), endMs: Date.parse("2026-08-24T00:00:00Z") };
    const ticks = axisTicks(win);
    expect(ticks.length).toBe(21);
    expect(ticks[0].label).toBe("8/3");
    expect(ticks[20].label).toBe("8/23");
    expect(ticks[0].leftPct).toBeCloseTo((0.5 / 21) * 100, 5); // centered over the day cell
    expect(weekendBands(win).length).toBe(3); // one Sat-Sun band per week
  });
  it("labels every other day in a 6-week window", () => {
    const win = { startMs: Date.parse("2026-08-03T00:00:00Z"), endMs: Date.parse("2026-09-14T00:00:00Z") }; // 42 days
    const ticks = axisTicks(win);
    expect(ticks.length).toBe(21);
    expect(ticks[0].label).toBe("8/3");
    expect(ticks[1].label).toBe("8/5");
  });
  it("falls back to weekly Monday ticks between 45 and 120 days", () => {
    const win = { startMs: Date.parse("2026-08-03T00:00:00Z"), endMs: Date.parse("2026-10-12T00:00:00Z") }; // 70 days
    const ticks = axisTicks(win);
    expect(ticks[0].label).toBe("8/3");
    expect(ticks[1].label).toBe("8/10");
  });
  it("switches to monthly ticks and drops weekend bands past 120 days", () => {
    const win = { startMs: Date.parse("2026-01-01T00:00:00Z"), endMs: Date.parse("2026-12-31T00:00:00Z") };
    expect(axisTicks(win).map((t) => t.label)).toContain("2/1");
    expect(weekendBands(win)).toEqual([]);
  });
});
