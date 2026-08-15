import { describe, it, expect, beforeEach } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth";
import { readSession } from "@/lib/scope";

beforeEach(() => {
  process.env.APP_PASSWORD = "secret123";
  process.env.APP_ADMIN_PASSWORD = "adminsecret456";
  process.env.SESSION_SIGNING_SECRET = "l".repeat(32);
});

function post(password: string) {
  const form = new FormData();
  form.append("password", password);
  return new Request("http://localhost/api/login", { method: "POST", body: form });
}

function sessionValue(cookies: string): string {
  return cookies.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? "";
}

describe("login route", () => {
  it("sets one signed, non-admin session cookie for the shared password", async () => {
    const { POST } = await import("@/app/api/login/route");
    const res = await POST(post("secret123"));
    expect(res.status).toBe(303);
    const cookies = res.headers.getSetCookie().join("; ");
    // SECURITY_REMEDIATION_HANDOFF #1: no second admin cookie is issued at all.
    expect(cookies).not.toContain("sms_admin");
    const session = await readSession(decodeURIComponent(sessionValue(cookies)), Math.floor(Date.now() / 1000));
    expect(session?.admin).toBe(false);
  });

  it("marks the session admin for the admin password, without a second cookie", async () => {
    const { POST } = await import("@/app/api/login/route");
    const cookies = (await POST(post("adminsecret456"))).headers.getSetCookie().join("; ");
    expect(cookies).not.toContain("sms_admin");
    const session = await readSession(decodeURIComponent(sessionValue(cookies)), Math.floor(Date.now() / 1000));
    expect(session?.admin).toBe(true);
  });

  it("never puts the signing secret in the cookie", async () => {
    const { POST } = await import("@/app/api/login/route");
    const cookies = (await POST(post("adminsecret456"))).headers.getSetCookie().join("; ");
    expect(cookies).not.toContain(process.env.SESSION_SIGNING_SECRET);
  });

  it("redirects with an error and sets no cookie for a wrong password", async () => {
    const { POST } = await import("@/app/api/login/route");
    const res = await POST(post("nope"));
    expect(res.headers.get("location")).toContain("error=1");
    expect(res.headers.getSetCookie().join("; ")).not.toContain(SESSION_COOKIE);
  });

  it("refuses an empty password even when APP_PASSWORD is unset", async () => {
    process.env.APP_PASSWORD = "";
    process.env.APP_ADMIN_PASSWORD = "";
    const { POST } = await import("@/app/api/login/route");
    expect((await POST(post(""))).headers.get("location")).toContain("error=1");
  });
});

// SECURITY_REMEDIATION_HANDOFF #5 — no rate limiting or lockout on /api/login.
describe("login rate limiting", () => {
  function postFrom(password: string, ip: string) {
    const form = new FormData();
    form.append("password", password);
    return new Request("http://localhost/api/login", {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": ip },
    });
  }

  it("stops accepting the correct password after repeated failures from one IP", async () => {
    const { POST } = await import("@/app/api/login/route");
    const ip = `10.0.0.${Math.floor(Math.random() * 200) + 1}`;

    for (let i = 0; i < 10; i += 1) {
      const res = await POST(postFrom("wrong", ip));
      expect(res.headers.get("location")).toContain("error=1");
    }

    // Even the RIGHT password is now refused — the window, not the password, decides.
    const blocked = await POST(postFrom("secret123", ip));
    expect(blocked.headers.get("location")).toContain("error=1");
    expect(blocked.headers.getSetCookie().join("; ")).not.toContain(SESSION_COOKIE);
  });

  it("does not throttle a different IP", async () => {
    const { POST } = await import("@/app/api/login/route");
    const attacker = `10.1.0.${Math.floor(Math.random() * 200) + 1}`;
    for (let i = 0; i < 10; i += 1) await POST(postFrom("wrong", attacker));

    const other = await POST(postFrom("secret123", "10.9.9.9"));
    expect(other.headers.get("location")).not.toContain("error=1");
  });

  it("clears the window on a successful login", async () => {
    const { POST } = await import("@/app/api/login/route");
    const ip = `10.2.0.${Math.floor(Math.random() * 200) + 1}`;
    for (let i = 0; i < 9; i += 1) await POST(postFrom("wrong", ip));

    expect((await POST(postFrom("secret123", ip))).headers.get("location")).not.toContain("error=1");
    // Window reset, so a fresh run of failures is needed to throttle again.
    expect((await POST(postFrom("wrong", ip))).headers.get("location")).toContain("error=1");
    expect((await POST(postFrom("secret123", ip))).headers.get("location")).not.toContain("error=1");
  });
});
