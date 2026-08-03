// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ProjectTabs } from "@/components/ProjectTabs";
import { StatStrip } from "@/components/StatStrip";
import { ExportMenu } from "@/components/ExportMenu";

afterEach(() => cleanup());

describe("ProjectTabs", () => {
  it("links both tabs and shows the badge when items are open", () => {
    render(<ProjectTabs projectId="p1" active="schedule" dataBadge={14} />);
    const links = screen.getAllByRole("link");
    expect(links[0].getAttribute("href")).toBe("/projects/p1");
    expect(links[1].getAttribute("href")).toBe("/projects/p1/data");
    expect(screen.getByText("14")).toBeTruthy();
  });
  it("hides the badge at zero", () => {
    render(<ProjectTabs projectId="p1" active="data" dataBadge={0} />);
    expect(screen.queryByText("0")).toBeNull();
  });
});

describe("StatStrip", () => {
  it("shows positive drift as +Nd and links % complete and last update", () => {
    render(<StatStrip projectId="p1" driftDays={3} atRiskCount={4} percentComplete={62} lastUpdate={{ daysAgo: 6 }} />);
    expect(screen.getByText("+3d")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("+3d").closest("a")!.getAttribute("href")).toBe("/projects/p1?sort=drift");
    expect(screen.getByText("4").closest("a")!.getAttribute("href")).toBe("/projects/p1?filter=at_risk");
    expect(screen.getByText("62%").closest("a")!.getAttribute("href")).toBe("/projects/p1/health");
    expect(screen.getByText("6d ago").closest("a")!.getAttribute("href")).toBe("/projects/p1/updates");
  });
  it("reads on plan at zero drift and goes amber past 7 days stale", () => {
    render(<StatStrip projectId="p1" driftDays={0} atRiskCount={0} percentComplete={10} lastUpdate={{ daysAgo: 14 }} />);
    expect(screen.getByText("on plan")).toBeTruthy();
    const stale = screen.getByText("14d ago");
    expect(stale.className).toContain("text-amber-700");
  });
  it("says never when no update has been finalized", () => {
    render(<StatStrip projectId="p1" driftDays={0} atRiskCount={0} percentComplete={0} lastUpdate={null} />);
    expect(screen.getByText("never")).toBeTruthy();
  });
});

describe("ExportMenu", () => {
  it("contains the MS Project XML item linking to the export page", () => {
    render(<ExportMenu projectId="p1" />);
    expect(screen.getByText("MS Project XML").closest("a")!.getAttribute("href")).toBe("/projects/p1/export");
  });
});
