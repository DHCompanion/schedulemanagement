import { describe, it, expect } from "vitest";
import { isWeekend, addWorkingDays, workingDaysBetween } from "@/lib/forecast/workingDays";

// 2026-08-03 is a Monday.
const mon = new Date("2026-08-03T08:00:00Z");
const fri = new Date("2026-08-07T17:00:00Z");
const sat = new Date("2026-08-08T10:00:00Z");

describe("isWeekend", () => {
  it("is false for Monday and true for Saturday/Sunday (UTC)", () => {
    expect(isWeekend(mon)).toBe(false);
    expect(isWeekend(sat)).toBe(true);
    expect(isWeekend(new Date("2026-08-09T10:00:00Z"))).toBe(true);
  });
});

describe("addWorkingDays", () => {
  it("adds zero days as identity on a weekday", () => {
    expect(addWorkingDays(mon, 0).toISOString()).toBe(mon.toISOString());
  });
  it("rolls a weekend start forward to Monday even for zero days", () => {
    expect(addWorkingDays(sat, 0).toISOString()).toBe("2026-08-10T10:00:00.000Z");
  });
  it("adds whole days within a week, preserving time of day", () => {
    const r = addWorkingDays(mon, 3);
    expect(r.getUTCDate()).toBe(6); // Mon Aug 3 + 3 → Thu Aug 6
    expect(r.getUTCHours()).toBe(8);
  });
  it("skips the weekend", () => {
    expect(addWorkingDays(fri, 1).getUTCDate()).toBe(10); // Fri + 1 → Mon Aug 10
    expect(addWorkingDays(mon, 5).getUTCDate()).toBe(10); // Mon + 5 → next Mon
  });
  it("carries fractional days as clock time", () => {
    const r = addWorkingDays(mon, 2.5);
    expect(r.getUTCDate()).toBe(5);   // Mon + 2 → Wed Aug 5 ...
    expect(r.getUTCHours()).toBe(20); // ... + 0.5 × 24h from 08:00 → 20:00
  });
  it("rolls a fractional landing off the weekend", () => {
    const r = addWorkingDays(fri, 0.5); // Fri 17:00 + 12h = Sat 05:00 → Mon 05:00
    expect(r.getUTCDay()).toBe(1);
    expect(r.getUTCHours()).toBe(5);
  });
  it("steps a negative whole day backward", () => {
    const r = addWorkingDays(new Date("2026-08-12T17:00:00Z"), -1); // Wed → Tue
    expect(r.toISOString()).toBe("2026-08-11T17:00:00.000Z");
  });
  it("steps a negative whole day backward over the weekend", () => {
    const r = addWorkingDays(new Date("2026-08-10T08:00:00Z"), -1); // Mon → Fri
    expect(r.toISOString()).toBe("2026-08-07T08:00:00.000Z");
  });
  it("rolls a negative fractional landing backward off the weekend", () => {
    const r = addWorkingDays(new Date("2026-08-10T08:00:00Z"), -0.5); // Mon 08:00 - 12h = Sun 20:00 → Fri 20:00
    expect(r.getUTCDay()).toBe(5);
    expect(r.getUTCHours()).toBe(20);
    expect(r.toISOString()).toBe("2026-08-07T20:00:00.000Z");
  });
});

describe("workingDaysBetween", () => {
  it("is 0 for the same UTC date regardless of time", () => {
    expect(workingDaysBetween(new Date("2026-08-03T01:00:00Z"), new Date("2026-08-03T23:00:00Z"))).toBe(0);
  });
  it("counts weekdays forward", () => {
    expect(workingDaysBetween(mon, new Date("2026-08-06T00:00:00Z"))).toBe(3);
  });
  it("does not count weekend days", () => {
    expect(workingDaysBetween(fri, new Date("2026-08-10T00:00:00Z"))).toBe(1); // Fri → Mon
    expect(workingDaysBetween(fri, sat)).toBe(0);                              // Fri → Sat
  });
  it("is negative when b precedes a", () => {
    expect(workingDaysBetween(new Date("2026-08-10T00:00:00Z"), fri)).toBe(-1);
  });
});
