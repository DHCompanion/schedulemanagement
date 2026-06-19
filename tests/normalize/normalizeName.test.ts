import { describe, it, expect } from "vitest";
import { normalizeName } from "@/lib/normalize/normalizeName";

describe("normalizeName", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeName("  Electrical   Rough-In  ")).toBe("electrical rough-in");
  });
  it("is idempotent", () => {
    const once = normalizeName("MEP  Rough");
    expect(normalizeName(once)).toBe(once);
  });
});
