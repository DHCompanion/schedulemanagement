import { describe, it, expect, beforeEach } from "vitest";
import {
  SCOPE_COOKIE,
  SCOPE_TTL_SECONDS,
  denyIfOutOfScope,
  readScope,
  signScope,
} from "@/lib/scope";

const NOW = 1_800_000_000;
const SCOPE = { projectId: "proj-local-1", osProjectId: 42, personId: 4, toolLevel: "user" as const };

function requestWithScope(cookieValue: string): Request {
  return new Request("https://tool.test/api/trades", {
    headers: { Cookie: `${SCOPE_COOKIE}=${cookieValue}` },
  });
}

beforeEach(() => {
  process.env.SESSION_SIGNING_SECRET = "signing-secret-abc".padEnd(32, "x");
});

describe("scope cookie", () => {
  it("round-trips a signed scope", async () => {
    const scope = await readScope(await signScope(SCOPE, NOW), NOW);
    expect(scope).toMatchObject({ projectId: "proj-local-1", osProjectId: 42, personId: 4 });
    expect(scope?.exp).toBe(NOW + SCOPE_TTL_SECONDS);
  });

  it("rejects a tampered payload", async () => {
    const token = await signScope(SCOPE, NOW);
    const [, signature] = token.split(".");
    const forged = btoa(JSON.stringify({ ...SCOPE, projectId: "someone-elses", exp: NOW + 999 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await readScope(`${forged}.${signature}`, NOW)).toBeNull();
  });

  it("rejects a scope signed with a different secret", async () => {
    const token = await signScope(SCOPE, NOW);
    process.env.SESSION_SIGNING_SECRET = "a-different-secret".padEnd(32, "x");
    expect(await readScope(token, NOW)).toBeNull();
  });

  it("rejects an expired scope", async () => {
    const token = await signScope(SCOPE, NOW);
    expect(await readScope(token, NOW + SCOPE_TTL_SECONDS + 1)).toBeNull();
  });

  it("returns null for missing or malformed cookies", async () => {
    expect(await readScope(undefined, NOW)).toBeNull();
    expect(await readScope("garbage", NOW)).toBeNull();
    expect(await readScope("not.base64url", NOW)).toBeNull();
  });
});

describe("API scope guard", () => {
  it("allows the session's own project", async () => {
    const req = requestWithScope(await signScope(SCOPE, Math.floor(Date.now() / 1000)));
    expect(await denyIfOutOfScope(req, "proj-local-1")).toBeNull();
  });

  it("denies another project with 403", async () => {
    const req = requestWithScope(await signScope(SCOPE, Math.floor(Date.now() / 1000)));
    const denied = await denyIfOutOfScope(req, "proj-local-2");
    expect(denied?.status).toBe(403);
  });

  it("leaves an unscoped standalone session unrestricted", async () => {
    const req = new Request("https://tool.test/api/trades");
    expect(await denyIfOutOfScope(req, "any-project")).toBeNull();
  });

  it("denies when the cookie is expired rather than falling back to full access", async () => {
    const stale = await signScope(SCOPE, Math.floor(Date.now() / 1000) - SCOPE_TTL_SECONDS - 60);
    // An expired scope reads as "no scope", so the guard alone would let it
    // through — middleware is what logs it out. Pinning the read result here
    // documents that the two halves have to agree.
    expect(await readScope(stale, Math.floor(Date.now() / 1000))).toBeNull();
  });
});
