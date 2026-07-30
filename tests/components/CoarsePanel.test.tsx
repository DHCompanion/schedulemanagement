// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch } from "../helpers/renderClient";
import { CoarsePanel } from "@/components/CoarsePanel";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const rows = [{ name: "MEP OH Rough-In", count: 8, finerScopes: [] }];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("CoarsePanel", () => {
  it("tells a non-admin they cannot mark scopes, and offers no input", () => {
    render(<CoarsePanel rows={rows} isAdmin={false} />);
    expect(screen.getByText(/Only an admin can mark scopes as coarse/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Too coarse\?/i)).toBeNull();
  });

  it("posts one rule per comma-separated finer scope, keyed on the raw name", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<CoarsePanel rows={rows} isAdmin />);
    fireEvent.change(screen.getByPlaceholderText(/Too coarse\?/i), {
      target: { value: "Electrical Rough, Plumbing Rough" },
    });
    fireEvent.click(screen.getByText("Save coarse markings"));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => c.body)).toEqual([
      { coarseScope: "MEP OH Rough-In", finerScope: "Electrical Rough" },
      { coarseScope: "MEP OH Rough-In", finerScope: "Plumbing Rough" },
    ]);
    expect(calls[0]).toMatchObject({ url: "/api/completeness/split-rules", method: "POST" });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("reports the server's refusal instead of failing silently", async () => {
    stubFetch({ ok: false, body: { error: { message: "Admin access required." } } });
    render(<CoarsePanel rows={rows} isAdmin />);
    fireEvent.change(screen.getByPlaceholderText(/Too coarse\?/i), { target: { value: "A" } });
    fireEvent.click(screen.getByText("Save coarse markings"));

    await waitFor(() => expect(screen.getByText("Admin access required.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("disables Save until something is typed", () => {
    render(<CoarsePanel rows={rows} isAdmin />);
    const save = screen.getByText("Save coarse markings") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it("filters the name list by the search box", () => {
    render(<CoarsePanel rows={[...rows, { name: "Hang Drywall", count: 2, finerScopes: [] }]} isAdmin={false} />);
    fireEvent.change(screen.getByPlaceholderText("Search activity names"), { target: { value: "drywall" } });
    expect(screen.queryByText("MEP OH Rough-In")).toBeNull();
    expect(screen.getByText("Hang Drywall")).toBeTruthy();
  });
});
