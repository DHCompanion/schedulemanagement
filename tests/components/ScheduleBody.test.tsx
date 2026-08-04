// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { ScheduleBody } from "@/components/ScheduleBody";
import type { ScheduleRow } from "@/lib/schedule/types";

const mk = (over: Partial<ScheduleRow>): ScheduleRow => ({
  id: "x", externalId: 1, wbsCode: "1", name: "n", canonicalScope: null,
  disciplineName: null, partnerName: null, atRisk: false, procurement: null,
  type: "task", isCritical: false, outlineLevel: 1,
  plannedStart: "2026-08-03T08:00:00.000Z", plannedFinish: "2026-08-07T17:00:00.000Z",
  expectedStart: "2026-08-03T08:00:00.000Z", expectedFinish: "2026-08-07T17:00:00.000Z",
  driftDays: 0, pushedByName: null, status: "not_started",
  percentComplete: 0, totalSlackDays: null, durationDays: 5, customFields: {},
  ...over,
});

const rows: ScheduleRow[] = [
  mk({ id: "s1", type: "summary", name: "Rough-In", outlineLevel: 1 }),
  mk({ id: "a1", name: "Overhead MEP", outlineLevel: 2, wbsCode: "1.1", driftDays: 3, atRisk: true, disciplineName: "Mechanical" }),
  mk({ id: "a2", name: "Paint", outlineLevel: 2, wbsCode: "1.2", disciplineName: "Finishes" }),
];

afterEach(() => cleanup());

describe("ScheduleBody", () => {
  it("renders the grouped timeline with section header and activity count", () => {
    render(<ScheduleBody rows={rows} projectId="p1" statusDate="2026-08-05T00:00:00.000Z" view="full" initialFilter={null} initialSort={null} />);
    expect(screen.getByText("Rough-In")).toBeTruthy();
    expect(screen.getByText(/Showing 2 activities/)).toBeTruthy();
  });
  it("filters to at-risk from the initialFilter URL param", () => {
    render(<ScheduleBody rows={rows} projectId="p1" statusDate="2026-08-05T00:00:00.000Z" view="full" initialFilter="at_risk" initialSort={null} />);
    expect(screen.getByText("Overhead MEP")).toBeTruthy();
    expect(screen.queryByText("Paint")).toBeNull();
  });
  it("drift sort renders the flat list with the biggest slip first", () => {
    render(<ScheduleBody rows={rows} projectId="p1" statusDate="2026-08-05T00:00:00.000Z" view="full" initialFilter={null} initialSort="drift" />);
    const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names.findIndex((t) => t.includes("Overhead MEP"))).toBeLessThan(names.findIndex((t) => t.includes("Paint")));
    expect(screen.queryByText("Rough-In")).toBeNull(); // no section headers when flat
  });
  it("search narrows by name", () => {
    render(<ScheduleBody rows={rows} projectId="p1" statusDate="2026-08-05T00:00:00.000Z" view="full" initialFilter={null} initialSort={null} />);
    fireEvent.change(screen.getByPlaceholderText("Search name / WBS / ID"), { target: { value: "paint" } });
    expect(screen.queryByText("Overhead MEP")).toBeNull();
    expect(screen.getByText("Paint")).toBeTruthy();
  });
  it("view switcher links carry the view param", () => {
    render(<ScheduleBody rows={rows} projectId="p1" statusDate="2026-08-05T00:00:00.000Z" view="6wk" initialFilter={null} initialSort={null} />);
    expect(screen.getByText("3 wk").closest("a")!.getAttribute("href")).toBe("/projects/p1?view=3wk");
    expect(screen.getByText("Full").closest("a")!.getAttribute("href")).toBe("/projects/p1?view=full");
  });
  it("keeps the correct section name under a non-wbs sort", () => {
    render(<ScheduleBody rows={rows} projectId="p1" statusDate="2026-08-05T00:00:00.000Z" view="full" initialFilter={null} initialSort="drift" />);
    fireEvent.click(screen.getByText("Overhead MEP"));
    expect(screen.getByText(/Section: Rough-In/)).toBeTruthy();
  });
});
