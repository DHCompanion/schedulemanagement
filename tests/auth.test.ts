import { describe, it, expect, beforeEach } from "vitest";
import { canWrite, isToolAdmin, SESSION_COOKIE } from "@/lib/auth";
import { checkPassword, checkAdminPassword } from "@/lib/password";
import { SCOPE_COOKIE, isAdminRequest, readSession, signScope, signSession } from "@/lib/scope";

const SIGNING_SECRET = "s".repeat(32);

beforeEach(() => {
  process.env.APP_PASSWORD = "secret123";
  process.env.APP_ADMIN_PASSWORD = "adminsecret456";
  process.env.SESSION_SIGNING_SECRET = SIGNING_SECRET;
});

describe("auth", () => {
  it("exposes the cookie name", () => {
    expect(SESSION_COOKIE).toBe("sms_session");
  });
  it("checks the shared password", () => {
    expect(checkPassword("secret123")).toBe(true);
    expect(checkPassword("nope")).toBe(false);
    expect(checkPassword("")).toBe(false);
  });
  it("checks the admin password, independent of the regular one", () => {
    expect(checkAdminPassword("adminsecret456")).toBe(true);
    expect(checkAdminPassword("secret123")).toBe(false);
    expect(checkAdminPassword("")).toBe(false);
  });
  it("refuses any password when the expected one is unset", () => {
    process.env.APP_PASSWORD = "";
    expect(checkPassword("")).toBe(false);
    expect(checkPassword("anything")).toBe(false);
  });
  it("is admin iff toolLevel is exactly admin", () => {
    expect(isToolAdmin("admin")).toBe(true);
    expect(isToolAdmin("user")).toBe(false);
    expect(isToolAdmin("viewer")).toBe(false);
    expect(isToolAdmin(null)).toBe(false);
    expect(isToolAdmin(undefined)).toBe(false);
  });
  it("lets admin and user write, but not viewer or an absent level", () => {
    expect(canWrite("admin")).toBe(true);
    expect(canWrite("user")).toBe(true);
    expect(canWrite("viewer")).toBe(false);
    expect(canWrite(undefined)).toBe(false);
    expect(canWrite(null)).toBe(false);
  });
  it("treats an OS-launched session with toolLevel admin as admin", async () => {
    const now = Math.floor(Date.now() / 1000);
    const scoped = async (toolLevel: "admin" | "user" | "viewer" | undefined) =>
      new Request("http://localhost/x", {
        headers: {
          Cookie: `${SCOPE_COOKIE}=${await signScope(
            { projectId: "p1", osProjectId: 1, personId: 4, toolLevel },
            now,
          )}`,
        },
      });
    expect(await isAdminRequest(await scoped("admin"))).toBe(true);
    expect(await isAdminRequest(await scoped("user"))).toBe(false);
    expect(await isAdminRequest(await scoped("viewer"))).toBe(false);
    // A cookie minted before toolLevel existed carries none and must not crash,
    // nor must it default to admin.
    expect(await isAdminRequest(await scoped(undefined))).toBe(false);
  });
});

// SECURITY_REMEDIATION_HANDOFF #1 — the admin cookie used to hold the same value
// as the session cookie, so any logged-in user could copy one into the other.
describe("#1 admin cannot be self-granted by copying a cookie", () => {
  const now = () => Math.floor(Date.now() / 1000);

  async function req(cookie: string): Promise<Request> {
    return new Request("http://localhost/x", { headers: { Cookie: cookie } });
  }

  it("grants admin only to a session signed with the admin claim", async () => {
    const adminSession = await signSession(true, now());
    expect(await isAdminRequest(await req(`${SESSION_COOKIE}=${adminSession}`))).toBe(true);
  });

  it("does not grant admin to an ordinary signed session", async () => {
    const plainSession = await signSession(false, now());
    expect(await isAdminRequest(await req(`${SESSION_COOKIE}=${plainSession}`))).toBe(false);
  });

  it("does not honour a legacy sms_admin cookie holding the session value", async () => {
    const plainSession = await signSession(false, now());
    // The exact escalation the finding describes: copy your session value into
    // the old admin cookie name. That cookie is no longer read at all.
    const forged = `${SESSION_COOKIE}=${plainSession}; sms_admin=${plainSession}`;
    expect(await isAdminRequest(await req(forged))).toBe(false);
  });

  it("does not honour a hand-edited admin claim", async () => {
    // Re-encode a valid session with admin flipped to true, keeping the original
    // signature — the payload no longer matches, so the whole cookie is refused.
    const plainSession = await signSession(false, now());
    const [body, signature] = plainSession.split(".");
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString());
    const tampered = Buffer.from(JSON.stringify({ ...decoded, admin: true })).toString("base64url");
    expect(await readSession(`${tampered}.${signature}`, now())).toBeNull();
  });
});

// SECURITY_REMEDIATION_HANDOFF #2 — the signing key must be a distinct secret
// that is never emitted to a client.
describe("#2 the signing key is separate from any cookie value", () => {
  it("rejects a cookie signed with a different key", async () => {
    const session = await signSession(true, Math.floor(Date.now() / 1000));
    process.env.SESSION_SIGNING_SECRET = "d".repeat(32);
    expect(await readSession(session, Math.floor(Date.now() / 1000))).toBeNull();
  });

  it("refuses to sign with a missing or weak key rather than falling back", async () => {
    process.env.SESSION_SIGNING_SECRET = "";
    await expect(signSession(false, 0)).rejects.toThrow(/SESSION_SIGNING_SECRET/);
    process.env.SESSION_SIGNING_SECRET = "too-short";
    await expect(signSession(false, 0)).rejects.toThrow(/SESSION_SIGNING_SECRET/);
  });

  it("never emits the signing secret as a cookie value", async () => {
    const session = await signSession(true, Math.floor(Date.now() / 1000));
    expect(session).not.toContain(SIGNING_SECRET);
  });
});
