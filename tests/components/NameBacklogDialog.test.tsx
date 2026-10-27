// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { NameBacklogDialog } from "@/components/NameBacklogDialog";

const row = (name: string, over: Record<string, unknown> = {}) => ({
  normalizedName: name, rawName: name, taskCount: 4, projectCount: 2, samples: [{ project: "MRMC ED", type: "Emergency Department", parent: "Zone 4", days: 5 }],
  kind: "map", suggestion: "Paint", covers: [], confidence: "high", reason: "Same work as Paint", source: "ai", poolTasks: 100,
  ...over,
});

describe("NameBacklogDialog", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("walks the backlog one name at a time and posts the chosen action", async () => {
    const posts: { name: string }[] = [];
    // Like the server: settled names drop out of the next fetch.
    const all = [row("paint walls"), row("vavs", { kind: "procurement", suggestion: "", confidence: "medium" })];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return Response.json({ ok: true }); }
      return Response.json({ rows: all.filter((r) => !posts.some((p) => p.name === r.normalizedName)), progress: { names: 2, settledNames: 0, poolTasks: 100, coverage: 0.9, high: 1 }, high: [] });
    }));
    render(<NameBacklogDialog scopes={["Paint", "Frame"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Review backlog/ }));

    expect(await screen.findByText("paint walls")).toBeTruthy();
    expect(screen.getByText(/Zone 4/)).toBeTruthy();
    expect(screen.getByText(/90% of tasks covered/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve: Paint" }));
    await waitFor(() => expect(posts).toEqual([{ name: "paint walls", action: "map", scope: "Paint" }]));

    expect(await screen.findByText("vavs")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Another standard name"), { target: { value: "Frame" } });
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(posts.at(-1)).toEqual({ name: "vavs", action: "map", scope: "Frame" }));
  });

  it("lists the high-confidence names before approving them all", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return Response.json({ approved: 1 }); }
      return Response.json({ rows: [row("paint walls")], progress: { names: 1, settledNames: 0, poolTasks: 100, coverage: 0.9, high: 1 }, high: [{ rawName: "paint walls", suggestion: "Paint" }] });
    }));
    render(<NameBacklogDialog scopes={["Paint"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Review backlog/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve all high-confidence (1)" }));
    expect(screen.getByText("paint walls → Paint")).toBeTruthy();
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Map 1 name" }));
    await waitFor(() => expect(posts).toEqual([{ approveHigh: true }]));
  });

  it("skipping asks for more names, so later ones are reachable", async () => {
    const urls: string[] = [];
    const all = [row("a"), row("b")];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      const limit = Number(new URL(url, "http://x").searchParams.get("limit"));
      return Response.json({ rows: all.slice(0, Math.min(limit, 1 + urls.length - 1)), progress: { names: 2, settledNames: 0, poolTasks: 100, coverage: 0.9, high: 0 }, high: [] });
    }));
    render(<NameBacklogDialog scopes={["Paint"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Review backlog/ }));
    expect(await screen.findByText("a")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(await screen.findByText("b")).toBeTruthy();
    expect(urls.at(-1)).toContain("limit=26");
  });
});
