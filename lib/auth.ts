export const SESSION_COOKIE = "sms_session";

// The OS's single authority signal, already collapsed from per-project role +
// org-wide profile. `none` never reaches a launched tool (the OS refuses the
// launch), so this tool only ever sees the three below.
export type ToolLevel = "admin" | "user" | "viewer";

// Password checks live in lib/password.ts — they need node:crypto, and this
// module is imported by edge middleware where that is unavailable.

// Admin from an OS launch: the OS's own toolLevel, a single signal it already
// resolved from project access + org-wide role. Anything but "admin" (including
// absent, e.g. a pre-toolLevel cookie) is not admin.
export function isToolAdmin(toolLevel: ToolLevel | null | undefined): boolean {
  return toolLevel === "admin";
}

// viewer is read-only. Enforced on every mutating request in middleware.
export function canWrite(toolLevel: ToolLevel | null | undefined): boolean {
  return toolLevel === "admin" || toolLevel === "user";
}

// Scoped to the base path so that, once the tool is proxied under
// sgconnect.dev/schedule-manager, its session cookie is never sent to the OS or
// to any other tool sharing the domain.
//
// `secure` is unconditional: http://localhost is a secure context, so it costs
// local dev nothing, and a deployed environment that somehow lacks
// NODE_ENV=production must not silently start sending session cookies in clear.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: true,
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
