// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { TimelineView, type TimelineItem } from "@/components/TimelineView";
import type { ScheduleRow } from "@/lib/schedule/types";

const win = { startMs: Date.parse("2026-08-03T00:00:00Z"), endMs: Date.parse("2026-08-31T00:00:00Z") };

const base = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: "a1", externalId: 1, wbsCode: "1.1", name: "MEP R/I L2", canonicalScope: "Overhead MEP Rough-In",
  disciplineName: "Mechanical", partnerName: "TDI", atRisk: false, procurement: null,
  type: "task", isCritical: false, outlineLevel: 2,
  plannedStart: "2026-08-03T08:00:00.000Z", plannedFinish: "2026-08-07T17:00:00.000Z",
  expectedStart: "2026-08-03T08:00:00.000Z", expectedFinish: "2026-08-12T17:00:00.000Z",
  driftDays: 3, pushedByName: null, status: "in_progress",
  percentComplete: 45, totalSlackDays: null, durationDays: 5, customFields: {},
  ...over,
});
const item = (row: ScheduleRow, over: Partial<TimelineItem> = {}): TimelineItem =>
  ({ row, paletteIndex: 0, descendantCount: 0, sectionName: "Rough-In", ...over });

const noop = () => {};

afterEach(() => cleanup());

describe("TimelineView", () => {
  it("renders planned and expected bars with a red drift label", () => {
    const { container } = render(
      <TimelineView items={[item(base())]} window={win} todayIso="2026-08-05T00:00:00.000Z" openId={null} onToggleOpen={noop} collapsed={new Set()} onToggleCollapsed={noop} />,
    );
    expect(container.querySelector('[data-bar="planned"]')).toBeTruthy();
    expect(container.querySelector('[data-bar="expected"]')).toBeTruthy();
    expect(screen.getByText("+3d").className).toContain("text-red-600");
  });
  it("prefers the canonical name and keeps the raw name muted; AT RISK pill carries over", () => {
    render(
      <TimelineView items={[item(base({ atRisk: true }))]} window={win} todayIso="2026-08-05T00:00:00.000Z" openId={null} onToggleOpen={noop} collapsed={new Set()} onToggleCollapsed={noop} />,
    );
    expect(screen.getByText("Overhead MEP Rough-In")).toBeTruthy();
    expect(screen.getByText("MEP R/I L2")).toBeTruthy();
    expect(screen.getByText("AT RISK")).toBeTruthy();
  });
  it("draws milestones as diamonds, not bars", () => {
    const ms = base({ id: "m1", type: "milestone", durationDays: 0, plannedFinish: "2026-08-03T08:00:00.000Z", expectedFinish: "2026-08-03T08:00:00.000Z", driftDays: 0 });
    const { container } = render(
      <TimelineView items={[item(ms)]} window={win} todayIso="2026-08-05T00:00:00.000Z" openId={null} onToggleOpen={noop} collapsed={new Set()} onToggleCollapsed={noop} />,
    );
    expect(container.querySelector('[data-bar]')).toBeNull();
    expect(container.querySelector('[data-milestone]')).toBeTruthy();
  });
  it("summary rows show the palette header with count and fire collapse", () => {
    const summary = base({ id: "s1", type: "summary", outlineLevel: 1, name: "Level 2 Rough-In", canonicalScope: null });
    let toggled = "";
    render(
      <TimelineView items={[item(summary, { descendantCount: 7 })]} window={win} todayIso="2026-08-05T00:00:00.000Z" openId={null} onToggleOpen={noop} collapsed={new Set()} onToggleCollapsed={(id) => { toggled = id; }} />,
    );
    expect(screen.getByText(/7 activities/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Level 2 Rough-In/));
    expect(toggled).toBe("s1");
  });
  it("clicking a leaf opens the shared detail panel", () => {
    let opened = "";
    render(
      <TimelineView items={[item(base())]} window={win} todayIso="2026-08-05T00:00:00.000Z" openId={null} onToggleOpen={(id) => { opened = id; }} collapsed={new Set()} onToggleCollapsed={noop} />,
    );
    fireEvent.click(screen.getByText("Overhead MEP Rough-In"));
    expect(opened).toBe("a1");
  });
  it("shows the detail with section name when openId matches", () => {
    render(
      <TimelineView items={[item(base())]} window={win} todayIso="2026-08-05T00:00:00.000Z" openId="a1" onToggleOpen={noop} collapsed={new Set()} onToggleCollapsed={noop} />,
    );
    expect(screen.getByText(/Section: Rough-In/)).toBeTruthy();
  });
});
