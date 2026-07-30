import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getProjectContext, getTradePartners } from "@/lib/os-gateway";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { process.env.SKILES_OS_API_BASE_URL = "https://api.example.com/api"; });

function stub(ok: boolean, body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 401, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("os-gateway", () => {
  it("appends /tool-gateway to the configured base and sends the bearer token", async () => {
    const fetchMock = stub(true, { project: { id: 1, name: "P" } });
    await getProjectContext("tok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/api/tool-gateway/project-context");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.cache).toBe("no-store");
  });

  it("tolerates a trailing slash on the base url", async () => {
    process.env.SKILES_OS_API_BASE_URL = "https://api.example.com/api/";
    const fetchMock = stub(true, {});
    await getTradePartners("tok");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.com/api/tool-gateway/trade-partners");
  });

  it("throws a named error when the base url is unset", async () => {
    delete process.env.SKILES_OS_API_BASE_URL;
    await expect(getProjectContext("tok")).rejects.toThrow(/SKILES_OS_API_BASE_URL/);
  });

  it("throws with the status when the gateway rejects the token", async () => {
    stub(false);
    await expect(getProjectContext("expired")).rejects.toThrow(/401/);
  });
});
