import { describe, it, expect, beforeEach } from "vitest";
import { checkPassword, isAuthed, SESSION_COOKIE } from "@/lib/auth";

beforeEach(() => {
  process.env.APP_PASSWORD = "secret123";
  process.env.APP_SESSION_TOKEN = "token-abc";
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
  it("validates the session cookie against the token", () => {
    expect(isAuthed("token-abc")).toBe(true);
    expect(isAuthed("wrong")).toBe(false);
    expect(isAuthed(undefined)).toBe(false);
  });
});
