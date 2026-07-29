import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, isAdmin, isAdminRole, parseCookie } from "@/lib/auth";

// An OS-launched session. Unlike the shared-password session (a constant token),
// this cookie is signed and names exactly one project, so it both authenticates
// the user AND scopes them.
//
// The two session kinds are deliberately separate cookies. If a launch instead
// set the shared session cookie plus a scope cookie, deleting the scope cookie
// would leave a still-valid full-access session — expiry or a devtools click
// would be a privilege escalation. Here, dropping the scope cookie logs you out.
export const SCOPE_COOKIE = "sms_scope";

// A workday. Re-launch from Connect to refresh; the OS re-checks the person's
// project access when it mints the gateway token.
export const SCOPE_TTL_SECONDS = 12 * 60 * 60;

export type ProjectScope = {
  projectId: string;
  osProjectId: number;
  personId: number;
  /** Optional: absent from cookies minted before the banner existed. */
  personName?: string | null;
  accessRole: string | null;
  exp: number;
};

const encoder = new TextEncoder();

// Web Crypto, not node:crypto — this has to verify in edge middleware as well as
// in Node route handlers.
async function signingKey(): Promise<CryptoKey> {
  const secret = process.env.APP_SESSION_TOKEN ?? "";
  if (!secret) throw new Error("APP_SESSION_TOKEN is not set; cannot sign a scope cookie");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  // Backed by a plain ArrayBuffer so it satisfies BufferSource — Uint8Array.from
  // widens to ArrayBufferLike, which crypto.subtle does not accept.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function signScope(scope: Omit<ProjectScope, "exp">, nowSeconds: number): Promise<string> {
  const payload: ProjectScope = { ...scope, exp: nowSeconds + SCOPE_TTL_SECONDS };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function readScope(raw: string | undefined, nowSeconds: number): Promise<ProjectScope | null> {
  if (!raw) return null;
  const [body, signature] = raw.split(".");
  if (!body || !signature) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      fromBase64Url(signature),
      encoder.encode(body)
    );
    if (!valid) return null;
    const scope = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as ProjectScope;
    if (typeof scope.exp !== "number" || scope.exp <= nowSeconds) return null;
    if (typeof scope.projectId !== "string" || typeof scope.osProjectId !== "number") return null;
    return scope;
  } catch {
    return null;
  }
}

export function scopeCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: process.env.NEXT_PUBLIC_BASE_PATH || "/",
    maxAge: SCOPE_TTL_SECONDS,
  };
}

export function scopeFromRequest(req: Request, nowSeconds: number): Promise<ProjectScope | null> {
  return readScope(parseCookie(req, SCOPE_COOKIE), nowSeconds);
}

// Admin from either session kind: the standalone admin password, or an OS launch
// whose handed-down access role is allowlisted. Takes raw cookie values so both
// route handlers (plain Request) and server components (next/headers) can call
// it — next/headers must not be imported here, this module also runs in edge
// middleware.
export async function isAdminFromCookies(
  adminCookie: string | undefined,
  scopeCookie: string | undefined,
  nowSeconds: number
): Promise<boolean> {
  if (isAdmin(adminCookie)) return true;
  return isAdminRole((await readScope(scopeCookie, nowSeconds))?.accessRole);
}

// Route handlers receive a plain Request, not a NextRequest, and next/headers'
// cookies() requires Next's request-scoped context (absent when a test calls
// a route's exported handler directly) — so admin checks in routes parse the
// raw Cookie header instead.
export function isAdminRequest(req: Request): Promise<boolean> {
  return isAdminFromCookies(
    parseCookie(req, ADMIN_SESSION_COOKIE),
    parseCookie(req, SCOPE_COOKIE),
    Math.floor(Date.now() / 1000)
  );
}

// API routes carry the project in a body or path param, which middleware cannot
// read, so each project-scoped route checks here. A request with no scope cookie
// is a standalone/admin session and stays unrestricted.
export async function denyIfOutOfScope(req: Request, projectId: string): Promise<NextResponse | null> {
  return denyOutOfScope(await scopeFromRequest(req, Math.floor(Date.now() / 1000)), projectId);
}

// Same check against an already-read scope, for routes that also need the actor
// id off it and shouldn't verify the cookie twice.
export function denyOutOfScope(scope: ProjectScope | null, projectId: string): NextResponse | null {
  if (!scope || scope.projectId === projectId) return null;
  return NextResponse.json(
    { error: { message: "That project is outside this session's scope." } },
    { status: 403 }
  );
}
