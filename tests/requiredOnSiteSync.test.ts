import { describe, it, expect } from "vitest";
import { isRequiredOnSiteOutOfSync } from "../lib/schedule/requiredOnSiteSync";

describe("isRequiredOnSiteOutOfSync", () => {
  it("flags a required-on-site date that falls after the activity start (the stale-link case)", () => {
    // AHU-1: required 10/5 but the activity starts 9/21 — material needed after work begins.
    expect(isRequiredOnSiteOutOfSync("2026-10-05T00:00:00.000Z", "2026-09-21T00:00:00.000Z")).toBe(true);
  });
  it("flags a required-on-site date equal to the start (material only arrives the day work begins)", () => {
    expect(isRequiredOnSiteOutOfSync("2026-09-21T00:00:00.000Z", "2026-09-21T00:00:00.000Z")).toBe(true);
  });
  it("does not flag a healthy required-on-site date before the start", () => {
    expect(isRequiredOnSiteOutOfSync("2026-09-16T00:00:00.000Z", "2026-09-21T00:00:00.000Z")).toBe(false);
  });
  it("compares by calendar date, ignoring any time-of-day component", () => {
    // required-on-site later in the day but same date as an early start → still on/after
    expect(isRequiredOnSiteOutOfSync("2026-09-21T23:00:00.000Z", "2026-09-21T06:00:00.000Z")).toBe(true);
    // required-on-site the day before → not flagged regardless of time
    expect(isRequiredOnSiteOutOfSync("2026-09-20T23:00:00.000Z", "2026-09-21T01:00:00.000Z")).toBe(false);
  });
  it("returns false when either date is missing", () => {
    expect(isRequiredOnSiteOutOfSync(null, "2026-09-21T00:00:00.000Z")).toBe(false);
    expect(isRequiredOnSiteOutOfSync("2026-10-05T00:00:00.000Z", null)).toBe(false);
    expect(isRequiredOnSiteOutOfSync(null, null)).toBe(false);
  });
});
