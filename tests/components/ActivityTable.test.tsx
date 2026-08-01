// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { ActivityTable, type ActivityRow } from "@/components/ActivityTable";

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: "a1",
  externalId: 101,
  wbsCode: "1.2.3",
  name: "Electrical Rough-In L2",
  canonicalScope: null,
  disciplineName: "26A: ELECTRICAL",
  partnerName: "Amber Electrical Contractors, Inc.",
  atRisk: false,
  procurement: null,
  type: "task",
  isCritical: false,
  outlineLevel: 2,
  plannedStart: "2026-08-11T00:00:00.000Z",
  plannedFinish: "2026-09-04T00:00:00.000Z",
  percentComplete: 40,
  totalSlackDays: 3.5,
  durationDays: 18,
  customFields: {},
  ...over,
});

afterEach(() => cleanup());

describe("ActivityTable AT RISK pill", () => {
  it("marks an activity whose partner procurement flagged", () => {
    render(<ActivityTable rows={[row({ atRisk: true })]} />);
    expect(screen.getByText("AT RISK")).toBeTruthy();
  });

  it("leaves an unflagged activity unmarked", () => {
    render(<ActivityTable rows={[row()]} />);
    expect(screen.queryByText("AT RISK")).toBeNull();
  });

  it("does not roll the pill up onto a WBS section header", () => {
    render(
      <ActivityTable
        rows={[
          row({ id: "s1", wbsCode: "1", name: "Level 2", type: "summary", outlineLevel: 1, atRisk: true }),
          row({ id: "a1", wbsCode: "1.1", atRisk: true }),
        ]}
      />,
    );
    // One pill, on the leaf — a header pill cannot say which child is affected.
    expect(screen.getAllByText("AT RISK")).toHaveLength(1);
  });
});

describe("ActivityTable procurement detail", () => {
  const procurement = {
    itemCount: 9,
    behindCount: 8,
    submittalLateCount: 7,
    projectedLateCount: 1,
    releasedAtRiskCount: 0,
    missingDatesCount: 0,
  };

  // The detail only exists once the row is expanded — the table renders it
  // behind a tap, so every assertion here has to open the row first.
  function openFirstRow() {
    fireEvent.click(screen.getByRole("button", { name: /Electrical Rough-In L2/ }));
  }

  it("explains the flag under the trade partner", () => {
    render(<ActivityTable rows={[row({ atRisk: true, procurement })]} />);
    openFirstRow();
    expect(screen.getByText(/This trade's procurement: 8 of 9 items behind/)).toBeTruthy();
    expect(screen.getByText("7 submittal late, 1 projected late")).toBeTruthy();
  });

  it("reports a trade that is checked and fine", () => {
    // behindCount must stay consistent with its parts: it is
    // submittalLateCount + projectedLateCount on the producing side.
    const clean = { ...procurement, behindCount: 0, submittalLateCount: 0, projectedLateCount: 0 };
    render(<ActivityTable rows={[row({ procurement: clean })]} />);
    openFirstRow();
    expect(screen.getByText(/9 items, none behind/)).toBeTruthy();
    expect(screen.queryByText(/submittal late/)).toBeNull();
  });

  it("says nothing when the partner has no cached procurement data", () => {
    render(<ActivityTable rows={[row({ atRisk: true, procurement: null })]} />);
    openFirstRow();
    expect(screen.queryByText(/This trade's procurement/)).toBeNull();
  });

  it("still describes the trade on a completed activity", () => {
    // The pill is a call to action and page.tsx suppresses it at 100%; the line
    // is reference data about the trade and is not suppressed. Only the line is
    // asserted here — the suppression rule lives in isActivityAtRisk, which has
    // its own test, and this component just renders whatever atRisk it is given.
    render(<ActivityTable rows={[row({ percentComplete: 100, atRisk: false, procurement })]} />);
    openFirstRow();
    expect(screen.getByText(/This trade's procurement: 8 of 9 items behind/)).toBeTruthy();
  });
});
