// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { DraftChecklist } from "@/components/DraftChecklist";

describe("DraftChecklist", () => {
  afterEach(cleanup);
  it("hides names that don't match every word, keeping them in the form", () => {
    const items = [{ name: "Install RF Shielding", share: 0.3, checked: true }, { name: "Demolish RF Shielding", share: 0.2, checked: false }, { name: "Frame Walls", share: 0.8, checked: true }];
    const { container } = render(<form><DraftChecklist items={items} /></form>);
    fireEvent.change(screen.getByLabelText("Search names"), { target: { value: "rf inst" } });
    const shown = [...container.querySelectorAll("label")].filter((l) => !l.className.includes("hidden")).map((l) => l.textContent);
    expect(shown).toEqual(["Install RF Shielding30%"]);
    // Frame Walls is hidden but still ticked, so it still submits.
    expect(new FormData(container.querySelector("form")!).getAll("scope")).toEqual(["Install RF Shielding", "Frame Walls"]);
    fireEvent.change(screen.getByLabelText("Search names"), { target: { value: "zzz" } });
    expect(screen.getByText(/No names match/)).toBeTruthy();
  });
});
