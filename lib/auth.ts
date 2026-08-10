export const SESSION_COOKIE = "sms_session";
export const ADMIN_SESSION_COOKIE = "sms_admin";

// The OS's single authority signal, already collapsed from per-project role +
// org-wide profile. `none` never reaches a launched tool (the OS refuses the
// launch), so this tool only ever sees the three below.
export type ToolLevel = "admin" | "user" | "viewer";

export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD ?? "";
  return expected.length > 0 && input === expected;
}

export function checkAdminPassword(input: string): boolean {
  const expected = process.env.APP_ADMIN_PASSWORD ?? "";
  return expected.length > 0 && input === expected;
}

export function sessionToken(): string {
  return process.env.APP_SESSION_TOKEN ?? "";
}

export function isAuthed(cookieValue: string | undefined): boolean {
  const token = sessionToken();
  return token.length > 0 && cookieValue === token;
}

// Admin sessions are flagged by a second cookie carrying the same secret
// session token — set only when login used APP_ADMIN_PASSWORD. Reusing the
// token (rather than minting a second secret) keeps this a one-env-var change.
export function isAdmin(cookieValue: string | undefined): boolean {
  const token = sessionToken();
  return token.length > 0 && cookieValue === token;
}

// The other way in: an OS-launched session never sees the admin password, so
// admin there is the OS's own toolLevel — a single signal the OS already
// resolved from project access + org-wide role. Anything but "admin"
// (including absent, e.g. a pre-toolLevel cookie) is not admin.
export function isToolAdmin(toolLevel: ToolLevel | null | undefined): boolean {
  return toolLevel === "admin";
}

// Scoped to the base path so that, once the tool is proxied under
// sgconnect.dev/schedule-manager, its session cookie is never sent to the OS or
// to any other tool sharing the domain.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: process.env.NEXT_PUBLIC_BASE_PATH || "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export function parseCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}
