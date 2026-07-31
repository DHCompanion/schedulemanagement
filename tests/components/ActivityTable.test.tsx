// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
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
