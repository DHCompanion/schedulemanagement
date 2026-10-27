// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { DraftTypePicker } from "@/components/DraftTypePicker";

const types = [{ sector: "Healthcare", types: ["Clinic", "Imaging & Radiology", "Special Procedure (EP, Cath, IR)"] }];
const subTypes = { "Imaging & Radiology": ["MRI", "CT"], "Special Procedure (EP, Cath, IR)": ["EP", "Cath", "IR"] };

describe("DraftTypePicker", () => {
  afterEach(cleanup);
  it("shows the subtype select only for a type that has subtypes, starting fresh on a new type", () => {
    render(<DraftTypePicker types={types} subTypes={subTypes} type="Imaging & Radiology" subType="MRI" className="" />);
    expect((screen.getByLabelText("Subtype") as HTMLSelectElement).value).toBe("MRI");
    fireEvent.change(screen.getByLabelText("Project type"), { target: { value: "Clinic" } });
    expect(screen.queryByLabelText("Subtype")).toBeNull();
    fireEvent.change(screen.getByLabelText("Project type"), { target: { value: "Special Procedure (EP, Cath, IR)" } });
    expect((screen.getByLabelText("Subtype") as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("option", { name: "IR" })).toBeTruthy();
  });
});
