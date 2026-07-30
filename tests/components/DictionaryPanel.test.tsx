// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch } from "../helpers/renderClient";
import { DictionaryPanel } from "@/components/DictionaryPanel";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const rows = [{ rawName: "Hang Drywall L2", canonicalScope: "Hang Drywall", count: 4 }];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("DictionaryPanel", () => {
  it("offers no Unmap button to a non-admin", () => {
    render(<DictionaryPanel rows={rows} isAdmin={false} />);
    expect(screen.queryByText("Unmap")).toBeNull();
  });

  it("unmaps by raw name", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<DictionaryPanel rows={rows} isAdmin />);
    fireEvent.click(screen.getByText("Unmap"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/normalize",
      method: "DELETE",
      body: { rawName: "Hang Drywall L2" },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("surfaces a failure message", async () => {
    stubFetch({ ok: false, body: { error: { message: "Admin access required." } } });
    render(<DictionaryPanel rows={rows} isAdmin />);
    fireEvent.click(screen.getByText("Unmap"));
    await waitFor(() => expect(screen.getByText("Admin access required.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
