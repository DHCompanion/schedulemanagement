// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch } from "../helpers/renderClient";
import { TradesPanel } from "@/components/TradesPanel";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const disciplines = [{ id: 26, name: "26A: ELECTRICAL", division: "" }];
const base = {
  projectId: "p1",
  disciplineRows: [],
  assignmentRows: [],
  disciplines,
  dismissedScopes: [] as string[],
  driftRows: [],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("TradesPanel", () => {
  it("explains itself when the project has no roster", () => {
    render(<TradesPanel {...base} disciplines={[]} />);
    expect(screen.getByText(/No trade partners for this project yet/i)).toBeTruthy();
  });

  it("opens on Unmapped Activities while anything is unmapped", () => {
    render(<TradesPanel {...base} disciplineRows={[{ canonicalScope: "Pull Wire", suggestions: disciplines }]} />);
    expect(screen.getByText("Scope → discipline (global)")).toBeTruthy();
  });

  it("opens on Trade Assignment once nothing is unmapped", () => {
    render(<TradesPanel {...base} />);
    expect(screen.getByText("Discipline → trade partner (this project)")).toBeTruthy();
  });

  it("pre-selects the only partner covering a discipline", () => {
    render(
      <TradesPanel
        {...base}
        assignmentRows={[{
          osDisciplineId: 26, disciplineName: "26A: ELECTRICAL", currentPartnerId: null,
          currentPartnerName: "", onRoster: true, partners: [{ osPartnerId: 77, name: "Amber" }],
        }]}
      />,
    );
    expect(screen.getByText(/selected for you, Save to confirm/i)).toBeTruthy();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("77");
  });

  it("saves the pre-selected assignment", async () => {
    const { calls } = stubFetch({ ok: true });
    render(
      <TradesPanel
        {...base}
        assignmentRows={[{
          osDisciplineId: 26, disciplineName: "26A: ELECTRICAL", currentPartnerId: null,
          currentPartnerName: "", onRoster: true, partners: [{ osPartnerId: 77, name: "Amber" }],
        }]}
      />,
    );
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "/api/trades", method: "POST" });
    expect(calls[0].body).toMatchObject({
      projectId: "p1",
      assignments: [{ osDisciplineId: 26, osPartnerId: 77 }],
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("dismisses a scope", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<TradesPanel {...base} disciplineRows={[{ canonicalScope: "Pull Wire", suggestions: [] }]} />);
    fireEvent.click(screen.getByText("Dismiss"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/trades/dismiss",
      method: "POST",
      body: { projectId: "p1", canonicalScope: "Pull Wire" },
    });
  });

  it("restores a dismissed scope", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<TradesPanel {...base} dismissedScopes={["Pull Wire"]} />);
    fireEvent.click(screen.getByText(`Dismissed (1)`));
    fireEvent.click(screen.getByText("Restore"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/trades/restore",
      method: "POST",
      body: { projectId: "p1", canonicalScope: "Pull Wire" },
    });
  });

  it("accepts a drift row's file value", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<TradesPanel {...base} driftRows={[{
      osDisciplineId: 26, disciplineName: "26A: ELECTRICAL",
      fileValue: "Facility Solutions", toolValue: "Amber", activityCount: 3,
    }]} />);
    fireEvent.click(screen.getByText("Changed in MS Project (1)"));
    fireEvent.click(screen.getByText("Accept file"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/trades/drift",
      method: "POST",
      body: { projectId: "p1", osDisciplineId: 26, fileValue: "Facility Solutions", action: "accept" },
    });
  });

  it("keeps the tool's value with action keep", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<TradesPanel {...base} driftRows={[{
      osDisciplineId: 26, disciplineName: "26A: ELECTRICAL",
      fileValue: "Facility Solutions", toolValue: "Amber", activityCount: 1,
    }]} />);
    fireEvent.click(screen.getByText("Changed in MS Project (1)"));
    fireEvent.click(screen.getByText("Keep this one"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect((calls[0].body as Record<string, unknown>).action).toBe("keep");
  });

  it("reports an off-roster refusal from the drift route", async () => {
    stubFetch({ ok: false, body: { error: { message: '"Nobody Ltd" is not a trade partner on this project in Skiles Connect.' } } });
    render(<TradesPanel {...base} driftRows={[{
      osDisciplineId: 26, disciplineName: "26A: ELECTRICAL",
      fileValue: "Nobody Ltd", toolValue: "Amber", activityCount: 1,
    }]} />);
    fireEvent.click(screen.getByText("Changed in MS Project (1)"));
    fireEvent.click(screen.getByText("Accept file"));

    await waitFor(() => expect(screen.getByText(/is not a trade partner on this project/)).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
