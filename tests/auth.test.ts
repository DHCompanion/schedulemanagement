import { describe, it, expect, beforeEach } from "vitest";
import { checkPassword, isAuthed, checkAdminPassword, isAdmin, isAdminRequest, SESSION_COOKIE, ADMIN_SESSION_COOKIE } from "@/lib/auth";

beforeEach(() => {
  process.env.APP_PASSWORD = "secret123";
  process.env.APP_ADMIN_PASSWORD = "adminsecret456";
  process.env.APP_SESSION_TOKEN = "token-abc";
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
  it("extracts the admin cookie from a raw Request", () => {
    const withCookie = new Request("http://localhost/x", { headers: { Cookie: `${ADMIN_SESSION_COOKIE}=token-abc` } });
    expect(isAdminRequest(withCookie)).toBe(true);
    const wrongValue = new Request("http://localhost/x", { headers: { Cookie: `${ADMIN_SESSION_COOKIE}=nope` } });
    expect(isAdminRequest(wrongValue)).toBe(false);
    const noCookie = new Request("http://localhost/x");
    expect(isAdminRequest(noCookie)).toBe(false);
    const otherCookie = new Request("http://localhost/x", { headers: { Cookie: `${SESSION_COOKIE}=token-abc` } });
    expect(isAdminRequest(otherCookie)).toBe(false);
  });
});
