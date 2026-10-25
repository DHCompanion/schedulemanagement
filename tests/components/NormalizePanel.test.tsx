// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch } from "../helpers/renderClient";
import { NormalizePanel } from "@/components/NormalizePanel";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const rows = [{ rawName: "Hang Drywall L2", count: 3, suggestions: ["Hang Drywall"] }];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("NormalizePanel", () => {
  it("sends one mapping per confirmed name", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<NormalizePanel projectId="p1" rows={rows} knownScopes={["Hang Drywall"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Hang Drywall" }));   // suggestion chip
    fireEvent.click(screen.getByText("Save mappings"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/normalize",
      method: "POST",
      body: { mappings: [{ rawName: "Hang Drywall L2", canonicalScope: "Hang Drywall" }] },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("offers only approved names", () => {
    render(<NormalizePanel projectId="p1" rows={rows} knownScopes={["Hang Drywall", "Paint"]} />);
    const options = [...screen.getByLabelText("Standard name for Hang Drywall L2").querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Standard name…", "Hang Drywall", "Paint"]);
    expect(screen.queryByText("Use as-is")).toBeNull();
  });

  it("requests a name the list lacks instead of mapping it to itself", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<NormalizePanel projectId="p1" rows={rows} knownScopes={[]} />);
    fireEvent.click(screen.getByText("Request as new name"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ url: "/api/normalize/requests", method: "POST", body: { projectId: "p1", rawName: "Hang Drywall L2" } });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("shows a pending request instead of the button", () => {
    render(<NormalizePanel projectId="p1" rows={[{ ...rows[0], requested: true }]} knownScopes={[]} />);
    expect(screen.getByText("Requested as a new name")).toBeTruthy();
    expect(screen.queryByText("Request as new name")).toBeNull();
  });

  it("sends nothing for a name left blank", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<NormalizePanel projectId="p1" rows={rows} knownScopes={[]} />);
    fireEvent.click(screen.getByText("Save mappings"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect((calls[0].body as { mappings: unknown[] }).mappings).toEqual([]);
  });

  it("shows the server's message on failure", async () => {
    stubFetch({ ok: false, body: { error: { message: "mappings array required." } } });
    render(<NormalizePanel projectId="p1" rows={rows} knownScopes={[]} />);
    fireEvent.click(screen.getByText("Save mappings"));
    await waitFor(() => expect(screen.getByText("mappings array required.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
