import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { SESSION_COOKIE } from "@/lib/auth";
import { SCOPE_COOKIE, signScope, signSession } from "@/lib/scope";

beforeEach(() => {
  process.env.SESSION_SIGNING_SECRET = "m".repeat(32);
});

const now = () => Math.floor(Date.now() / 1000);

async function scopedRequest(
  toolLevel: "admin" | "user" | "viewer" | undefined,
  method: string,
  path = "/api/projects/p1/updates",
) {
  const scope = await signScope({ projectId: "p1", osProjectId: 1, personId: 4, toolLevel }, now());
  const req = new NextRequest(`https://sgconnect.dev${path}`, { method });
  req.cookies.set(SCOPE_COOKIE, scope);
  return middleware(req);
}

// SECURITY_REMEDIATION_HANDOFF #3 — toolLevel was consumed only for the admin
// bit, so a viewer could commit imports, finalize updates and assign trades.
describe("#3 the OS toolLevel ladder is enforced on mutating requests", () => {
  it("blocks a viewer from every mutating verb", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const res = await scopedRequest("viewer", method);
      expect(res.status, `viewer should not ${method}`).toBe(403);
    }
  });

  it("still lets a viewer read", async () => {
    const res = await scopedRequest("viewer", "GET", "/projects/p1");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets user and admin write", async () => {
    for (const level of ["user", "admin"] as const) {
      const res = await scopedRequest(level, "POST");
      expect(res.status, `${level} should be able to write`).toBe(200);
    }
  });

  it("treats a scope cookie minted before toolLevel existed as viewer, not a writer", async () => {
    expect((await scopedRequest(undefined, "POST")).status).toBe(403);
  });

  it("leaves the standalone password session write-capable (it carries no OS level)", async () => {
    const req = new NextRequest("https://sgconnect.dev/api/projects/p1/updates", { method: "POST" });
    req.cookies.set(SESSION_COOKIE, await signSession(false, now()));
    expect((await middleware(req)).status).toBe(200);
  });
});

// SECURITY_REMEDIATION_HANDOFF #5 — public-path matching was startsWith, so a
// path merely *beginning* with a public one skipped the session check entirely.
describe("#5 public paths match exactly, not by bare prefix", () => {
  it("does not treat lookalike paths as public", async () => {
    for (const path of ["/launchX", "/api/healthz", "/api/os-contextY", "/loginhack"]) {
      const res = await middleware(new NextRequest(`https://sgconnect.dev${path}`));
      expect(res.headers.get("location"), `${path} must not be public`).toContain("/login");
    }
  });

  it("still lets the real public paths through", async () => {
    for (const path of ["/login", "/api/login", "/launch", "/api/health", "/api/os-context"]) {
      const res = await middleware(new NextRequest(`https://sgconnect.dev${path}`, { method: "POST" }));
      expect(res.headers.get("location"), `${path} should be public`).toBeNull();
    }
  });

  it("still lets a real sub-path of a public path through", async () => {
    const res = await middleware(new NextRequest("https://sgconnect.dev/api/health/db"));
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("session required", () => {
  it("redirects an unauthenticated request to /login", async () => {
    const res = await middleware(new NextRequest("https://sgconnect.dev/projects/p1"));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("refuses a session cookie holding an unsigned constant", async () => {
    // The old scheme's cookie value was a shared constant; it must no longer authenticate.
    const req = new NextRequest("https://sgconnect.dev/projects/p1");
    req.cookies.set(SESSION_COOKIE, "346d50832cb3904d68f083ec8d2859cb");
    expect((await middleware(req)).headers.get("location")).toContain("/login");
  });
});
