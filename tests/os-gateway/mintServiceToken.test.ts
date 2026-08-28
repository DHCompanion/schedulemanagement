import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintServiceToken } from "@/lib/os-gateway";

const ENV_KEYS = ["SKILES_OS_API_BASE_URL", "SCHEDULE_MANAGER_CONTEXT_SECRET"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.SKILES_OS_API_BASE_URL = "https://os.example/api";
  process.env.SCHEDULE_MANAGER_CONTEXT_SECRET = "s3cret";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

describe("mintServiceToken", () => {
  it("signs the raw body with the context secret and posts it", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ token: "tok", expiresAt: "x" }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await mintServiceToken(42)).toBe("tok");
    expect(calls[0].url).toBe("https://os.example/api/tool-gateway/service-sessions");

    const body = JSON.parse(String(calls[0].init.body)) as { toolSlug: string; projectId: number; issuedAt: string };
    expect(body).toEqual({ toolSlug: "schedule-manager", projectId: 42, issuedAt: body.issuedAt });

    const expected = createHmac("sha256", "s3cret").update(`schedule-manager|42|${body.issuedAt}`).digest("base64url");
    expect((calls[0].init.headers as Record<string, string>)["x-tool-service-signature"]).toBe(expected);
  });

  it("throws on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(mintServiceToken(42)).rejects.toThrow();
  });

  it("throws when a 2xx response carries no token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ expiresAt: "x" }), { status: 201 })));
    await expect(mintServiceToken(42)).rejects.toThrow();
  });
});
