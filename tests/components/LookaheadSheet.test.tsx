// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { LookaheadSheet } from "@/components/LookaheadSheet";
import { lookaheadCss } from "@/components/lookaheadCss";
import type { LookaheadView } from "@/lib/lookahead/lookaheadView";

const view = (over: Partial<LookaheadView> = {}): LookaheadView => ({
  title: "3-Week Lookahead", windowLabel: "Aug 3–23, 2026",
  statusDateLabel: "Aug 4, 2026", generatedLabel: "Aug 5, 2026",
  stats: { driftDays: 4, atRiskCount: 2, percentComplete: 42, startingCount: 7 },
  attention: ["TDIndustries behind on 3 items — Overhead MEP at risk."],
  milestones: [{ name: "Permit", planned: "2026-08-10T17:00:00.000Z", expected: "2026-08-13T17:00:00.000Z", driftDays: 3, beyondWindow: false }],
  bands: [{
    trade: "Mechanical", partners: ["TDIndustries"], color: { bg: "#e0e7ff", text: "#312e81" },
    rows: [{
      id: "a1", name: "Overhead MEP", secondaryName: "MEP R/I L2", driftDays: 3, percentComplete: 40,
      isMilestone: false, isCritical: false, atRisk: true,
      bar: { leftPct: 10, widthPct: 20 }, ghostPct: 25, expectedPointPct: null, plannedPointPct: null,
    }],
  }],
  ticks: [{ leftPct: 5, label: "8/3" }],
  weekends: [{ leftPct: 60, widthPct: 9 }],
  todayPct: 12,
  ...over,
});

afterEach(() => cleanup());

describe("LookaheadSheet", () => {
  it("brands the header with the project and window", () => {
    render(<LookaheadSheet view={view()} projectName="BSW Regional ED" />);
    expect(screen.getByText(/Skiles Group · BSW Regional ED/)).toBeTruthy();
    expect(screen.getByText("3-Week Lookahead · Aug 3–23, 2026")).toBeTruthy();
    expect(screen.getByText(/Status date Aug 4, 2026/)).toBeTruthy();
    expect(screen.getByText(/Generated Aug 5, 2026/)).toBeTruthy();
  });

  it("shows the four stats, the attention sentences, and the milestone diamonds", () => {
    render(<LookaheadSheet view={view()} projectName="P" />);
    expect(screen.getByText("+4d")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("TDIndustries behind on 3 items — Overhead MEP at risk.")).toBeTruthy();
    expect(screen.getByText(/◇ Aug 10 → ◆ Aug 13/)).toBeTruthy();
  });

  it("bands rows by trade with the partner names and the band color", () => {
    const { container } = render(<LookaheadSheet view={view()} projectName="P" />);
    const band = container.querySelector<HTMLElement>("[data-band='Mechanical']")!;
    expect(band.getAttribute("style")).toContain("#e0e7ff");
    expect(band.textContent).toContain("Mechanical");
    expect(band.textContent).toContain("TDIndustries");
    expect(screen.getByText("Overhead MEP")).toBeTruthy();
    expect(container.querySelector(".drift")?.textContent).toBe("+3d");
    const bar = container.querySelector<HTMLElement>("[data-bar='expected']")!;
    expect(bar.style.left).toBe("10%");
    expect(bar.style.width).toBe("20%");
    expect(container.querySelector<HTMLElement>(".bar-fill")!.style.width).toBe("40%");
    expect(container.querySelector("[data-ghost]")).toBeTruthy();
  });

  it("says so when no activity falls in the window", () => {
    render(<LookaheadSheet view={view({ bands: [] })} projectName="P" />);
    expect(screen.getByText(/No activities fall in this window/)).toBeTruthy();
  });
});

describe("lookaheadCss", () => {
  it("sets the page size per format and never splits a band", () => {
    expect(lookaheadCss("tabloid")).toContain("size: 17in 11in");
    expect(lookaheadCss("letter")).toContain("size: 11in 8.5in");
    expect(lookaheadCss("tabloid")).toContain("break-inside: avoid");
    expect(lookaheadCss("tabloid")).toContain("print-color-adjust: exact");
  });
});
