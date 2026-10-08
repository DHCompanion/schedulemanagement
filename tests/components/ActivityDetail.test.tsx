// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ActivityDetail } from "@/components/ActivityDetail";
import type { ScheduleRow } from "@/lib/schedule/types";

const row = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: "a1", externalId: 101, wbsCode: "1.2", name: "MEP R/I L2", canonicalScope: "Overhead MEP Rough-In",
  disciplineName: "Mechanical", partnerName: "TDIndustries", atRisk: false, atRiskItem: null, procurement: null,
  type: "task", isCritical: false, outlineLevel: 2,
  plannedStart: "2026-08-03T08:00:00.000Z", plannedFinish: "2026-08-07T17:00:00.000Z",
  expectedStart: "2026-08-03T08:00:00.000Z", expectedFinish: "2026-08-12T17:00:00.000Z",
  driftDays: 3, pushedByName: null, externalUid: 1, pushedByUid: null, pushesCount: 0, status: "in_progress",
  percentComplete: 45, totalSlackDays: 3.5, durationDays: 5, customFields: {},
  ...over,
});

afterEach(() => cleanup());

describe("ActivityDetail", () => {
  it("shows planned vs expected dates with the drift delta", () => {
    render(<ActivityDetail row={row()} />);
    expect(screen.getByText(/Planned: Aug 3 → Aug 7/)).toBeTruthy();
    expect(screen.getByText(/Expected: Aug 3 → Aug 12/)).toBeTruthy();
    expect(screen.getByText("+3d")).toBeTruthy();
  });
  it("names the pushing predecessor when there is one", () => {
    render(<ActivityDetail row={row({ pushedByName: "Overhead MEP Rough-In", driftDays: 4 })} />);
    expect(screen.getByText(/Pushed by Overhead MEP Rough-In \(\+4d\)/)).toBeTruthy();
  });
  it("groups progress, trade and section, and hides values the row doesn't have", () => {
    render(<ActivityDetail row={row()} sectionName="Level 2 Rough-In" />);
    expect(screen.getByText("45% complete · 3.50d total float")).toBeTruthy();
    expect(screen.getByText("Mechanical")).toBeTruthy();
    expect(screen.getByText("TDIndustries")).toBeTruthy();
    expect(screen.getByText(/Section: Level 2 Rough-In/)).toBeTruthy();
    cleanup();
    render(<ActivityDetail row={row({ percentComplete: null, totalSlackDays: null, disciplineName: null, partnerName: null })} />);
    expect(screen.queryByText(/complete|float/)).toBeNull();
    expect(screen.queryByText("Trade")).toBeNull();
  });
  it("keeps the file's own fields behind a collapsed toggle", () => {
    const { container } = render(<ActivityDetail row={row({ customFields: { Area: "L2" } })} />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("ID: 101");
    expect(details.textContent).toContain("Area: L2");
  });
  it("renders procurement tallies when present", () => {
    render(<ActivityDetail row={row({ procurement: { itemCount: 9, behindCount: 3, submittalLateCount: 2, projectedLateCount: 1, releasedAtRiskCount: 0, missingDatesCount: 0 } })} />);
    expect(screen.getByText(/This trade's procurement/)).toBeTruthy();
    expect(screen.getByText("3 of 9 items behind").className).toContain("amber");
  });

  it("calls out the specific late item behind the at-risk tag", () => {
    render(<ActivityDetail row={row({ atRisk: true, atRiskItem: { state: "submitted", requiredOnSite: "2026-09-21T08:00:00.000Z" } })} />);
    expect(screen.getByText(/At risk: Linked procurement item behind — state: submitted; required on site Sep 21/)).toBeTruthy();
  });
});
