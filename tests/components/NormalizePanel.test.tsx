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
    render(<NormalizePanel rows={rows} knownScopes={["Hang Drywall"]} />);
    fireEvent.click(screen.getByText("Hang Drywall"));   // suggestion chip
    fireEvent.click(screen.getByText("Save mappings"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/normalize",
      method: "POST",
      body: { mappings: [{ rawName: "Hang Drywall L2", canonicalScope: "Hang Drywall" }] },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("maps a name to itself with Use as-is", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<NormalizePanel rows={rows} knownScopes={[]} />);
    fireEvent.click(screen.getByText("Use as-is"));
    fireEvent.click(screen.getByText("Save mappings"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect((calls[0].body as { mappings: unknown[] }).mappings).toEqual([
      { rawName: "Hang Drywall L2", canonicalScope: "Hang Drywall L2" },
    ]);
  });

  it("sends nothing for a name left blank", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<NormalizePanel rows={rows} knownScopes={[]} />);
    fireEvent.click(screen.getByText("Save mappings"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect((calls[0].body as { mappings: unknown[] }).mappings).toEqual([]);
  });

  it("shows the server's message on failure", async () => {
    stubFetch({ ok: false, body: { error: { message: "mappings array required." } } });
    render(<NormalizePanel rows={rows} knownScopes={[]} />);
    fireEvent.click(screen.getByText("Save mappings"));
    await waitFor(() => expect(screen.getByText("mappings array required.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
