import { describe, it, expect } from "vitest";
import { parseIsoDurationToMinutes, tenthsOfMinuteToMinutes, minutesToDays } from "@/lib/msp/duration";

describe("parseIsoDurationToMinutes", () => {
  it("parses hours/minutes/seconds", () => {
    expect(parseIsoDurationToMinutes("PT8H0M0S")).toBe(480);
    expect(parseIsoDurationToMinutes("PT0H30M0S")).toBe(30);
    expect(parseIsoDurationToMinutes("PT1H30M0S")).toBe(90);
  });
  it("returns null for empty/invalid", () => {
    expect(parseIsoDurationToMinutes(null)).toBeNull();
    expect(parseIsoDurationToMinutes("")).toBeNull();
    expect(parseIsoDurationToMinutes("garbage")).toBeNull();
  });
});

describe("tenthsOfMinuteToMinutes", () => {
  it("divides tenths of a minute", () => {
    expect(tenthsOfMinuteToMinutes("4800")).toBe(480);
    expect(tenthsOfMinuteToMinutes(0)).toBe(0);
  });
  it("returns null for empty", () => {
    expect(tenthsOfMinuteToMinutes(null)).toBeNull();
    expect(tenthsOfMinuteToMinutes("")).toBeNull();
  });
});

describe("minutesToDays", () => {
  it("converts using minutesPerDay", () => {
    expect(minutesToDays(480, 480)).toBe(1);
    expect(minutesToDays(960, 480)).toBe(2);
  });
  it("returns null when minutes is null", () => {
    expect(minutesToDays(null, 480)).toBeNull();
  });
});
