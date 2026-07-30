// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { WizardBanner } from "@/components/WizardBanner";

afterEach(cleanup);

describe("WizardBanner", () => {
  it("labels the step and orders the wizard granularity before naming", () => {
    render(<WizardBanner projectId="p1" step={1} why="because" />);
    expect(screen.getByText(/step 2 of 3/i).textContent).toContain("Task Granularity");
    expect(screen.getByText("because")).toBeTruthy();
  });

  it("offers Finish setup on the last step and no Next", () => {
    render(<WizardBanner projectId="p1" step={2} why="last" />);
    expect(screen.getByText("Finish setup")).toBeTruthy();
    expect(screen.queryByText("Next")).toBeNull();
  });

  it("offers no Back on the first step", () => {
    render(<WizardBanner projectId="p1" step={0} why="first" />);
    expect(screen.queryByText("Back")).toBeNull();
  });
});
