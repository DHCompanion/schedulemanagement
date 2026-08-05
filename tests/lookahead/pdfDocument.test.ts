import { describe, it, expect } from "vitest";
import { lookaheadDocument, pdfFileName } from "@/lib/lookahead/pdfDocument";

describe("lookaheadDocument", () => {
  it("wraps the markup in a standalone document carrying its own styles", () => {
    const html = lookaheadDocument("<div class='sheet'>x</div>", "@page { size: 17in 11in; }");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@page { size: 17in 11in; }");
    expect(html).toContain("<div class='sheet'>x</div>");
    expect(html).not.toContain("<link"); // nothing to fetch — setContent has no origin
  });
});

describe("pdfFileName", () => {
  it("slugs the project and dates the file", () => {
    expect(pdfFileName("BSW Regional ED / Phase 2", 3, new Date("2026-08-05T12:00:00Z")))
      .toBe("bsw-regional-ed-phase-2-3wk-lookahead-2026-08-05.pdf");
  });
  it("falls back when the name slugs to nothing", () => {
    expect(pdfFileName("///", 6, new Date("2026-08-05T12:00:00Z")))
      .toBe("project-6wk-lookahead-2026-08-05.pdf");
  });
});
