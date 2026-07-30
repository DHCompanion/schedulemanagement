import { describe, it, expect, beforeEach } from "vitest";
import { SESSION_COOKIE, ADMIN_SESSION_COOKIE } from "@/lib/auth";

beforeEach(() => {
  process.env.APP_PASSWORD = "secret123";
  process.env.APP_ADMIN_PASSWORD = "adminsecret456";
  process.env.APP_SESSION_TOKEN = "token-abc";
});

function post(password: string) {
  const form = new FormData();
  form.append("password", password);
  return new Request("http://localhost/api/login", { method: "POST", body: form });
}

describe("login route", () => {
  it("sets the session cookie and no admin cookie for the shared password", async () => {
    const { POST } = await import("@/app/api/login/route");
    const res = await POST(post("secret123"));
    expect(res.status).toBe(303);
    const cookies = res.headers.getSetCookie().join("; ");
    expect(cookies).toContain(`${SESSION_COOKIE}=token-abc`);
    expect(cookies).not.toContain(ADMIN_SESSION_COOKIE);
  });

  it("sets both cookies for the admin password", async () => {
    const { POST } = await import("@/app/api/login/route");
    const cookies = (await POST(post("adminsecret456"))).headers.getSetCookie().join("; ");
    expect(cookies).toContain(`${SESSION_COOKIE}=token-abc`);
    expect(cookies).toContain(`${ADMIN_SESSION_COOKIE}=token-abc`);
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
