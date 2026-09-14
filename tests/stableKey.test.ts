import { describe, it, expect } from "vitest";
import { stableActivityKey } from "../lib/msp/stableKey";

describe("stableActivityKey", () => {
  it("uses the GUID when present", () => {
    expect(stableActivityKey({ externalGuid: "ABC-123", externalUid: 7 })).toBe("ABC-123");
  });
  it("falls back to a prefixed UID when there is no GUID", () => {
    expect(stableActivityKey({ externalGuid: null, externalUid: 7 })).toBe("uid:7");
  });
  it("never returns a bare number that could collide with a GUID", () => {
    expect(stableActivityKey({ externalGuid: null, externalUid: 7 })).not.toBe("7");
  });
});
