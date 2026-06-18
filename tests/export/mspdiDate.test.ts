import { describe, it, expect } from "vitest";
import { toMspdiDate } from "@/lib/export/mspdiDate";

describe("toMspdiDate", () => {
  it("formats a stored UTC wall-clock date as a naive MSPDI string", () => {
    expect(toMspdiDate(new Date("2025-06-03T17:00:00Z"))).toBe("2025-06-03T17:00:00");
  });
  it("renders a date-only value at midnight", () => {
    expect(toMspdiDate(new Date("2026-06-15T00:00:00Z"))).toBe("2026-06-15T00:00:00");
  });
  it("zero-pads month, day, and time components", () => {
    expect(toMspdiDate(new Date("2026-01-05T08:09:07Z"))).toBe("2026-01-05T08:09:07");
  });
});
