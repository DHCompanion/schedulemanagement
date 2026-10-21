// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch } from "../helpers/renderClient";
import { LookaheadUpdateForm, type LookaheadFormRow } from "@/components/LookaheadUpdateForm";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const row: LookaheadFormRow = {
  externalUid: 7,
  canonicalActivityKey: "1.1|hang drywall",
  wbsCode: "1.1",
  wbsPath: ["Phase 1", "Interiors"],
  name: "Hang Drywall",
  type: "task",
  plannedStart: "2026-08-01",
  plannedFinish: "2026-08-05",
  slippage: "on-track",
  status: "not_started",
  actualStart: "",
  actualFinish: "",
  percentComplete: null,
  note: "",
  forecastStart: null,
  forecastFinish: null,
  dueByDataDate: true,
};
const noImpacts = { ok: true, body: { impacts: [] } };
const impact = {
  externalUid: 20, canonicalActivityKey: "1.3|paint", name: "Paint", wbsCode: "1.3",
  kind: "push", drivenByUid: 7, drivenByName: "Hang Drywall", note: "waiting on drywall",
  currentStart: "2026-08-10T08:00:00.000Z", currentFinish: "2026-08-14T17:00:00.000Z",
  proposedStart: "2026-08-12T08:00:00.000Z", proposedFinish: "2026-08-18T17:00:00.000Z",
};

type Entry = Record<string, unknown>;
const entriesOf = (call: { body: unknown }) => (call.body as { entries: Entry[] }).entries;
const renderForm = (rows: LookaheadFormRow[], readOnly = false) =>
  render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={rows} readOnly={readOnly} />);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("LookaheadUpdateForm", () => {
  it("shows a WBS header only where the section changes", () => {
    renderForm([
      row,
      { ...row, externalUid: 8, canonicalActivityKey: "1.2|tape" },
      { ...row, externalUid: 9, canonicalActivityKey: "2.1|roof", wbsPath: ["Phase 1", "Roofing"] },
    ]);
    expect(screen.getAllByTestId("wbs-header").map((h) => h.textContent)).toEqual([
      "Phase 1 › Interiors",
      "Phase 1 › Roofing",
    ]);
  });

  it("titles every field", () => {
    renderForm([row]);
    for (const label of ["Actual start", "Actual finish", "% complete", "Note"]) expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.getByRole("group", { name: "Status" })).toBeTruthy();
  });

  it("shows only work due by the data date until upcoming is toggled on", () => {
    renderForm([row, { ...row, externalUid: 8, canonicalActivityKey: "1.2|tape", name: "Tape", dueByDataDate: false }]);
    expect(screen.queryByText("Tape")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show upcoming \(1\)/ }));
    expect(screen.getByText("Tape")).toBeTruthy();
  });

  it("Complete locks % to 100 and blocks saving without an actual finish", async () => {
    const { calls } = stubFetch(noImpacts);
    renderForm([row]);
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    const pct = screen.getByLabelText("% complete") as HTMLInputElement;
    expect(pct.value).toBe("100");
    expect(pct.disabled).toBe(true);
    fireEvent.click(screen.getByText("Save draft"));
    expect(screen.getByText("Enter an actual finish.")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("In progress needs an actual start", () => {
    stubFetch(noImpacts);
    renderForm([row]);
    fireEvent.click(screen.getByRole("button", { name: "In progress" }));
    fireEvent.click(screen.getByText("Save draft"));
    expect(screen.getByText("Enter an actual start.")).toBeTruthy();
  });

  it("Not started clears and disables the actuals", () => {
    renderForm([{ ...row, status: "in_progress", actualStart: "2026-08-01", percentComplete: 30 }]);
    fireEvent.click(screen.getByRole("button", { name: "Not started" }));
    const start = screen.getByLabelText("Actual start") as HTMLInputElement;
    expect(start.value).toBe("");
    expect(start.disabled).toBe(true);
    expect((screen.getByLabelText("% complete") as HTMLInputElement).value).toBe("");
  });

  it("quick actions fill from the plan", () => {
    renderForm([row]);
    fireEvent.click(screen.getByRole("button", { name: "Started on plan" }));
    expect((screen.getByLabelText("Actual start") as HTMLInputElement).value).toBe("2026-08-01");
    fireEvent.click(screen.getByRole("button", { name: "Completed as planned" }));
    expect((screen.getByLabelText("Actual finish") as HTMLInputElement).value).toBe("2026-08-05");
    expect((screen.getByLabelText("% complete") as HTMLInputElement).value).toBe("100");
  });

  it("counts unsaved changes", () => {
    renderForm([row]);
    expect(screen.queryByText(/unsaved/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "crew short" } });
    expect(screen.getByText("1 unsaved change")).toBeTruthy();
  });

  it("checks impacts, then posts every row's entry to the entries endpoint", async () => {
    const { calls } = stubFetch(noImpacts, { ok: true });
    renderForm([row]);
    fireEvent.click(screen.getByText("Save draft"));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toMatchObject({ url: "/api/updates/u1/impacts", method: "POST" });
    expect(calls[1]).toMatchObject({ url: "/api/updates/u1/entries", method: "POST" });
    const entries = entriesOf(calls[1]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ activityExternalUid: 7, canonicalActivityKey: "1.1|hang drywall" });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("normalises completed_as_planned to complete before sending", async () => {
    const { calls } = stubFetch(noImpacts, { ok: true });
    renderForm([{ ...row, status: "completed_as_planned", actualStart: "2026-08-01", actualFinish: "2026-08-05", percentComplete: 100 }]);
    fireEvent.click(screen.getByText("Save draft"));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(entriesOf(calls[1])[0].status).toBe("complete");
  });

  it("sends empty strings as null", async () => {
    const { calls } = stubFetch(noImpacts, { ok: true });
    renderForm([row]);
    fireEvent.click(screen.getByText("Save draft"));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(entriesOf(calls[1])[0].actualStart).toBeNull();
    expect(entriesOf(calls[1])[0].note).toBeNull();
  });

  it("shows a failure message and does not refresh", async () => {
    stubFetch(noImpacts, { ok: false, body: {} });
    renderForm([row]);
    fireEvent.click(screen.getByText("Save draft"));
    await waitFor(() => expect(screen.getByText("Failed to save.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not save when the impact check fails", async () => {
    const { calls } = stubFetch({ ok: false, body: {} });
    renderForm([row]);
    fireEvent.click(screen.getByText("Save draft"));
    await waitFor(() => expect(screen.getByText(/Couldn't check which activities move/)).toBeTruthy());
    expect(calls).toHaveLength(1);
  });

  it("chains a finalize request after saving entries", async () => {
    const { calls } = stubFetch(noImpacts, { ok: true });
    renderForm([row]);
    fireEvent.click(screen.getByText("Finalize"));

    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]).toMatchObject({ url: "/api/updates/u1/finalize", method: "POST" });
    // No JSON body on this one — it stays a plain fetch.
    expect(calls[2].body).toBeUndefined();
  });

  it("asks before moving pushed activities, and saves forecast dates for the ones adjusted", async () => {
    const { calls } = stubFetch({ ok: true, body: { impacts: [impact] } }, { ok: true });
    renderForm([row]);
    fireEvent.click(screen.getByText("Save draft"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Paint");
    expect(dialog.textContent).toContain("Hang Drywall");
    expect(calls).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Adjust Paint" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue and save draft" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(entriesOf(calls[1])).toContainEqual(expect.objectContaining({
      activityExternalUid: 20, canonicalActivityKey: "1.3|paint", status: "not_started", note: "waiting on drywall",
      forecastStart: impact.proposedStart, forecastFinish: impact.proposedFinish,
    }));
  });

  it("leaves pushed activities alone by default", async () => {
    const { calls } = stubFetch({ ok: true, body: { impacts: [impact] } }, { ok: true });
    renderForm([row]);
    fireEvent.click(screen.getByText("Save draft"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Continue and save draft" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(entriesOf(calls[1]).map((e) => e.activityExternalUid)).toEqual([7]);
  });

  it("adjusts a row already in the form in place", async () => {
    const paint = { ...row, externalUid: 20, canonicalActivityKey: "1.3|paint", name: "Paint", wbsPath: ["Phase 1", "Interiors"] };
    const { calls } = stubFetch({ ok: true, body: { impacts: [impact] } }, { ok: true });
    renderForm([row, paint]);
    fireEvent.click(screen.getByText("Save draft"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Adjust all" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue and save draft" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    const paintEntries = entriesOf(calls[1]).filter((e) => e.activityExternalUid === 20);
    expect(paintEntries).toHaveLength(1);
    expect(paintEntries[0].forecastStart).toBe(impact.proposedStart);
  });

  it("hides both buttons when read-only", () => {
    renderForm([row], true);
    expect(screen.queryByText("Save draft")).toBeNull();
    expect(screen.queryByText("Finalize")).toBeNull();
  });
});
