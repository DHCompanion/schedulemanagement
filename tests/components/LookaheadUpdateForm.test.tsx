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
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("LookaheadUpdateForm", () => {
  it("posts every row's entry to the update's entries endpoint", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={[row]} readOnly={false} />);
    fireEvent.click(screen.getByText("Save draft"));

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    expect(calls[0]).toMatchObject({ url: "/api/updates/u1/entries", method: "POST" });
    const entries = (calls[0].body as { entries: Record<string, unknown>[] }).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ activityExternalUid: 7, canonicalActivityKey: "1.1|hang drywall" });
  });

  it("normalises completed_as_planned to complete before sending", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={[{ ...row, status: "completed_as_planned" }]} readOnly={false} />);
    fireEvent.click(screen.getByText("Save draft"));

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    const entries = (calls[0].body as { entries: Record<string, unknown>[] }).entries;
    expect(entries[0].status).toBe("complete");
  });

  it("sends empty strings as null", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={[row]} readOnly={false} />);
    fireEvent.click(screen.getByText("Save draft"));

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    const entries = (calls[0].body as { entries: Record<string, unknown>[] }).entries;
    expect(entries[0].actualStart).toBeNull();
    expect(entries[0].note).toBeNull();
  });

  it("shows a failure message and does not refresh", async () => {
    stubFetch({ ok: false, body: {} });
    render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={[row]} readOnly={false} />);
    fireEvent.click(screen.getByText("Save draft"));
    await waitFor(() => expect(screen.getByText("Failed to save.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("chains a finalize request after saving entries", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={[row]} readOnly={false} />);
    fireEvent.click(screen.getByText("Finalize"));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({ url: "/api/updates/u1/finalize", method: "POST" });
    // No JSON body on this one — Phase C must leave it as a plain fetch.
    expect(calls[1].body).toBeUndefined();
  });

  it("hides both buttons when read-only", () => {
    render(<LookaheadUpdateForm updateId="u1" projectId="p1" rows={[row]} readOnly />);
    expect(screen.queryByText("Save draft")).toBeNull();
    expect(screen.queryByText("Finalize")).toBeNull();
  });
});
