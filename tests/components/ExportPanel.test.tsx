// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { ExportPanel } from "@/components/ExportPanel";

afterEach(() => cleanup());

const button = () => screen.getByRole("button", { name: "Generate updated file" }) as HTMLButtonElement;

describe("ExportPanel", () => {
  it("exports straight away when the original is on file", () => {
    render(<ExportPanel projectId="p1" hasStoredOriginal />);
    expect(button().disabled).toBe(false);
    expect(screen.getByText("Use a different copy of the file")).toBeTruthy();
  });

  it("waits for an upload when the original isn't on file", () => {
    render(<ExportPanel projectId="p1" hasStoredOriginal={false} />);
    expect(button().disabled).toBe(true);
    expect(screen.getByLabelText("Schedule XML file")).toBeTruthy();
  });
});
