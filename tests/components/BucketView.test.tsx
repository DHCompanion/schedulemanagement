// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { BucketView, type BucketRow } from "@/components/BucketView";
import type { ScheduleRow } from "@/lib/schedule/types";

const asOf = "2026-08-05T12:00:00.000Z"; // Wed; week = Aug 3–9

const base = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: "a1", externalId: 1, wbsCode: "1.1", name: "MEP R/I L2", canonicalScope: "Overhead MEP Rough-In",
  disciplineName: "Mechanical", partnerName: "TDIndustries", atRisk: false, procurement: null,
  type: "task", isCritical: false, outlineLevel: 2,
  plannedStart: "2026-08-03T08:00:00.000Z", plannedFinish: "2026-08-07T17:00:00.000Z",
  expectedStart: "2026-08-03T08:00:00.000Z", expectedFinish: "2026-08-07T17:00:00.000Z",
  driftDays: 0, pushedByName: null, status: "in_progress",
  percentComplete: 45, totalSlackDays: null, durationDays: 5, customFields: {},
  ...over,
});
const brow = (over: Partial<ScheduleRow> = {}, palette = 0): BucketRow =>
  ({ ...base(over), paletteIndex: palette, sectionName: "Rough-In" });

afterEach(() => cleanup());

describe("BucketView", () => {
  it("groups cards under labeled week buckets by expected dates", () => {
    render(
      <BucketView
        rows={[brow(), brow({ id: "a2", name: "Cable Tray", canonicalScope: null, status: "not_started", expectedStart: "2026-08-12T08:00:00.000Z" })]}
        asOfIso={asOf} openId={null} onToggleOpen={() => {}}
      />,
    );
    expect(screen.getByText("This week · Aug 3–9")).toBeTruthy();
    expect(screen.getByText("Next week · Aug 10–16")).toBeTruthy();
    expect(screen.getByText("Cable Tray")).toBeTruthy();
  });
  it("writes drift in words on a pushed card", () => {
    render(
      <BucketView
        rows={[brow({ status: "not_started", plannedStart: "2026-08-07T08:00:00.000Z", plannedFinish: "2026-08-11T17:00:00.000Z", expectedStart: "2026-08-12T08:00:00.000Z", expectedFinish: "2026-08-14T17:00:00.000Z", driftDays: 3, pushedByName: "Overhead MEP" })]}
        asOfIso={asOf} openId={null} onToggleOpen={() => {}}
      />,
    );
    expect(screen.getByText(/was Aug 7 → now Aug 12/)).toBeTruthy();
  });
  it("hides done inside a collapsed details element", () => {
    const { container } = render(
      <BucketView rows={[brow({ status: "complete", percentComplete: 100 })]} asOfIso={asOf} openId={null} onToggleOpen={() => {}} />,
    );
    const done = container.querySelector("details");
    expect(done).toBeTruthy();
    expect(done!.hasAttribute("open")).toBe(false);
  });
  it("empty buckets render nothing (no empty headings)", () => {
    render(<BucketView rows={[brow()]} asOfIso={asOf} openId={null} onToggleOpen={() => {}} />);
    expect(screen.queryByText(/Weeks 3–6/)).toBeNull();
  });
  it("tapping a card opens the shared detail", () => {
    let opened = "";
    render(<BucketView rows={[brow()]} asOfIso={asOf} openId={null} onToggleOpen={(id) => { opened = id; }} />);
    fireEvent.click(screen.getByText("Overhead MEP Rough-In"));
    expect(opened).toBe("a1");
  });
});
