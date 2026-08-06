import { describe, it, expect, beforeEach } from "vitest";
import { checkPassword, isAuthed, checkAdminPassword, isAdmin, isAdminRole, SESSION_COOKIE, ADMIN_SESSION_COOKIE } from "@/lib/auth";
import { SCOPE_COOKIE, isAdminRequest, signScope } from "@/lib/scope";

beforeEach(() => {
  process.env.APP_PASSWORD = "secret123";
  process.env.APP_ADMIN_PASSWORD = "adminsecret456";
  process.env.APP_SESSION_TOKEN = "token-abc";
  process.env.ADMIN_ACCESS_ROLES = "Project Manager,Superintendent";
  process.env.ADMIN_ROLE_PROFILES = "";
});

describe("auth", () => {
  it("exposes the cookie names", () => {
    expect(SESSION_COOKIE).toBe("sms_session");
    expect(ADMIN_SESSION_COOKIE).toBe("sms_admin");
  });
  it("checks the shared password", () => {
    expect(checkPassword("secret123")).toBe(true);
    expect(checkPassword("nope")).toBe(false);
    expect(checkPassword("")).toBe(false);
  });
  it("validates the session cookie against the token", () => {
    expect(isAuthed("token-abc")).toBe(true);
    expect(isAuthed("wrong")).toBe(false);
    expect(isAuthed(undefined)).toBe(false);
  });
  it("checks the admin password, independent of the regular one", () => {
    expect(checkAdminPassword("adminsecret456")).toBe(true);
    expect(checkAdminPassword("secret123")).toBe(false);
    expect(checkAdminPassword("")).toBe(false);
  });
  it("validates the admin cookie against the same session token", () => {
    expect(isAdmin("token-abc")).toBe(true);
    expect(isAdmin("wrong")).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
  it("extracts the admin cookie from a raw Request", async () => {
    const withCookie = new Request("http://localhost/x", { headers: { Cookie: `${ADMIN_SESSION_COOKIE}=token-abc` } });
    expect(await isAdminRequest(withCookie)).toBe(true);
    const wrongValue = new Request("http://localhost/x", { headers: { Cookie: `${ADMIN_SESSION_COOKIE}=nope` } });
    expect(await isAdminRequest(wrongValue)).toBe(false);
    const noCookie = new Request("http://localhost/x");
    expect(await isAdminRequest(noCookie)).toBe(false);
    const otherCookie = new Request("http://localhost/x", { headers: { Cookie: `${SESSION_COOKIE}=token-abc` } });
    expect(await isAdminRequest(otherCookie)).toBe(false);
  });
  it("matches an allowlisted OS access role, case- and space-insensitively", () => {
    expect(isAdminRole("Project Manager")).toBe(true);
    expect(isAdminRole("  superintendent ")).toBe(true);
    expect(isAdminRole("project team")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole("")).toBe(false);
  });
  it("grants no role admin when the allowlist is unset", () => {
    process.env.ADMIN_ACCESS_ROLES = "";
    expect(isAdminRole("Project Manager")).toBe(false);
  });
  it("matches an allowlisted org-wide role profile whatever the project role is", () => {
    process.env.ADMIN_ROLE_PROFILES = "Admin,Super Admin";
    expect(isAdminRole("project team", "Super Admin")).toBe(true);
    expect(isAdminRole(null, "  admin ")).toBe(true);
    expect(isAdminRole("project team", "Field Engineer")).toBe(false);
    expect(isAdminRole("project team", null)).toBe(false);
    expect(isAdminRole("project team", undefined)).toBe(false);
  });
  it("keeps the two allowlists apart — a project role never matches the profile list", () => {
    process.env.ADMIN_ACCESS_ROLES = "";
    process.env.ADMIN_ROLE_PROFILES = "Project Manager";
    expect(isAdminRole("Project Manager")).toBe(false);
    expect(isAdminRole(null, "Project Manager")).toBe(true);
  });
  it("grants no profile admin when that allowlist is unset", () => {
    process.env.ADMIN_ROLE_PROFILES = "";
    expect(isAdminRole("project team", "Super Admin")).toBe(false);
  });
  it("treats an OS-launched session with an allowlisted role as admin", async () => {
    const now = Math.floor(Date.now() / 1000);
    const scoped = async (accessRole: string | null) =>
      new Request("http://localhost/x", {
        headers: {
          Cookie: `${SCOPE_COOKIE}=${await signScope(
            { projectId: "p1", osProjectId: 1, personId: 4, accessRole },
            now,
          )}`,
        },
      });
    expect(await isAdminRequest(await scoped("Project Manager"))).toBe(true);
    expect(await isAdminRequest(await scoped("project team"))).toBe(false);
    expect(await isAdminRequest(await scoped(null))).toBe(false);
  });
  it("carries the role profile in the scope cookie so an OS admin is admin on any project", async () => {
    process.env.ADMIN_ACCESS_ROLES = "";
    process.env.ADMIN_ROLE_PROFILES = "Super Admin";
    const now = Math.floor(Date.now() / 1000);
    const scoped = async (roleProfile: string | null) =>
      new Request("http://localhost/x", {
        headers: {
          Cookie: `${SCOPE_COOKIE}=${await signScope(
            { projectId: "p1", osProjectId: 1, personId: 4, accessRole: "project team", roleProfile },
            now,
          )}`,
        },
      });
    expect(await isAdminRequest(await scoped("Super Admin"))).toBe(true);
    expect(await isAdminRequest(await scoped("Field Engineer"))).toBe(false);
    // A cookie minted before this existed carries no profile and must not crash.
    expect(await isAdminRequest(await scoped(null))).toBe(false);
  });
});
