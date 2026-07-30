// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { stubFetch, stubConfirm } from "../helpers/renderClient";
import { CompletenessIssuesTable } from "@/components/CompletenessIssuesTable";
import type { CompletenessIssue } from "@/lib/completeness/completenessChecks";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const issue = (key: string): CompletenessIssue => ({
  canonicalActivityKey: key,
  externalId: 1,
  wbsCode: "1.1",
  name: "MEP OH Rough-In",
  coarseScope: "MEP OH Rough-In",
  finerScopes: ["Electrical Rough", "Plumbing Rough"],
});
const issues = [issue("a|1"), issue("a|2")];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("CompletenessIssuesTable", () => {
  it("accepts by coarse scope, not by activity key", async () => {
    stubConfirm(true);
    const { calls } = stubFetch({ ok: true });
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.click(screen.getAllByText("Accept")[0]);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/completeness/accept",
      method: "POST",
      body: { projectId: "p1", coarseScope: "MEP OH Rough-In" },
    });
    expect((calls[0].body as Record<string, unknown>).canonicalActivityKey).toBeUndefined();
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("states the real blast radius in the confirmation", async () => {
    const confirmMock = stubConfirm(true);
    stubFetch({ ok: true });
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.click(screen.getAllByText("Accept")[0]);

    const asked = String(confirmMock.mock.calls[0][0]);
    expect(asked).toContain("2 activities");   // both flagged instances
    expect(asked).toContain("4 tasks");        // 2 activities x 2 finer scopes
    expect(asked).toContain("dismissed are left alone");
  });

  it("fires no request when the confirmation is declined", async () => {
    stubConfirm(false);
    const { calls } = stubFetch({ ok: true });
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.click(screen.getAllByText("Accept")[0]);

    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a failed accept", async () => {
    stubConfirm(true);
    stubFetch({ ok: false, body: { error: { message: "No split rule found for this coarse scope." } } });
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.click(screen.getAllByText("Accept")[0]);
    await waitFor(() => expect(screen.getByText("No split rule found for this coarse scope.")).toBeTruthy());
  });

  it("dismisses one activity by its own key", async () => {
    const { calls } = stubFetch({ ok: true });
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.click(screen.getAllByText("Dismiss")[0]);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: "/api/completeness/dismiss",
      method: "POST",
      body: { projectId: "p1", canonicalActivityKey: "a|1", coarseScope: "MEP OH Rough-In" },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  // This handler deliberately does not check res.ok before refreshing — that is
  // current behaviour being locked in here, not endorsed. If a later change adds
  // error handling to dismiss(), this test should fail on purpose so the change
  // updates the test intentionally instead of silently altering behaviour.
  it("still refreshes and shows no error when dismiss's response is not ok", async () => {
    stubFetch({ ok: false, body: { error: { message: "nope" } } });
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.click(screen.getAllByText("Dismiss")[0]);

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.queryByText("nope")).toBeNull();
  });

  it("filters by coarse scope", () => {
    render(<CompletenessIssuesTable projectId="p1" issues={issues} />);
    fireEvent.change(screen.getByPlaceholderText("Search name / WBS / ID"), { target: { value: "nomatch" } });
    expect(screen.getByText("0 flagged activities")).toBeTruthy();
  });
});
