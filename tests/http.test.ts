import { describe, it, expect, vi, afterEach } from "vitest";
import { sendJson } from "@/lib/http";

afterEach(() => vi.unstubAllGlobals());

describe("sendJson", () => {
  it("posts JSON and resolves null on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendJson("/api/thing", { a: 1 })).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/thing");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ a: 1 });
  });

  it("returns the server's error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ error: { message: "Admin access required." } }),
    }));
    expect(await sendJson("/api/thing", {})).toBe("Admin access required.");
  });

  it("falls back to a generic message when the body carries none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await sendJson("/api/thing", {})).toBe("Request failed.");
  });

  it("does not throw when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, json: async () => { throw new Error("not json"); },
    }));
    expect(await sendJson("/api/thing", {})).toBe("Request failed.");
  });

  it("honours an explicit method", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    await sendJson("/api/thing", { a: 1 }, "DELETE");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
  });
});
