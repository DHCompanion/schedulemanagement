// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch } from "../helpers/renderClient";
import { SplitRulesPanel } from "@/components/SplitRulesPanel";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const rules = [{ coarseScope: "MEP Rough", finerScopes: ["Electrical Rough", "Plumbing Rough"] }];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("SplitRulesPanel", () => {
  it("shows finer scopes as plain text for a non-admin, with no buttons", () => {
    render(<SplitRulesPanel rules={rules} isAdmin={false} />);
    expect(screen.getByText("Electrical Rough")).toBeTruthy();
    expect(screen.queryByText("Electrical Rough ×")).toBeNull();
  });

  it("removes a rule with the coarse and finer scope in the body", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<SplitRulesPanel rules={rules} isAdmin />);
    fireEvent.click(screen.getByText("Electrical Rough ×"));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/completeness/split-rules",
      method: "DELETE",
      body: { coarseScope: "MEP Rough", finerScope: "Electrical Rough" },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("renders the server's message and does not refresh when the call fails", async () => {
    stubFetch({ ok: false, body: { error: { message: "Admin access required." } } });
    render(<SplitRulesPanel rules={rules} isAdmin />);
    fireEvent.click(screen.getByText("Electrical Rough ×"));

    await waitFor(() => expect(screen.getByText("Admin access required.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});
