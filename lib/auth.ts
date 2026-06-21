export const SESSION_COOKIE = "sms_session";
export const ADMIN_SESSION_COOKIE = "sms_admin";

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

function parseCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

// Route handlers receive a plain Request, not a NextRequest, and next/headers'
// cookies() requires Next's request-scoped context (absent when a test calls
// a route's exported handler directly) — so admin checks in routes parse the
// raw Cookie header instead.
export function isAdminRequest(req: Request): boolean {
  return isAdmin(parseCookie(req, ADMIN_SESSION_COOKIE));
}
