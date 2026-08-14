import { NextResponse } from "next/server";
import { SESSION_COOKIE, isToolAdmin, parseCookie, type ToolLevel } from "@/lib/auth";

// An OS-launched session. Both session kinds are signed cookies; this one also
// names exactly one project, so it both authenticates the user AND scopes them.
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
  /**
   * The OS's single authority signal for this person on this project.
   * Optional: absent on a cookie minted before this field existed (or when
   * the OS omitted it) — treat a missing value as "viewer", never admin.
   */
  toolLevel?: ToolLevel;
  exp: number;
};

const encoder = new TextEncoder();

// Web Crypto, not node:crypto — this has to verify in edge middleware as well as
// in Node route handlers.
//
// SESSION_SIGNING_SECRET exists only on the server and is never emitted to a
// client in any form. It used to be APP_SESSION_TOKEN, which was ALSO handed out
// as the literal value of the session cookie — so anyone holding a session cookie
// held the key that forges arbitrary scope cookies (any projectId, any personId,
// toolLevel "admin"). One secret must not guard two trust levels.
async function signingKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SIGNING_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("SESSION_SIGNING_SECRET must be set and at least 32 characters");
  }
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

// Both cookie kinds are the same shape: base64url(JSON payload) "." HMAC of it.
async function sign(payload: object): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

// Returns the decoded payload only if the signature verifies AND exp is in the
// future. Everything past this point is a claim the server itself made.
async function readSigned<T extends { exp: number }>(raw: string | undefined, nowSeconds: number): Promise<T | null> {
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
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as T;
    if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function signScope(scope: Omit<ProjectScope, "exp">, nowSeconds: number): Promise<string> {
  return sign({ ...scope, exp: nowSeconds + SCOPE_TTL_SECONDS } satisfies ProjectScope);
}

export async function readScope(raw: string | undefined, nowSeconds: number): Promise<ProjectScope | null> {
  const scope = await readSigned<ProjectScope>(raw, nowSeconds);
  if (!scope) return null;
  if (typeof scope.projectId !== "string" || typeof scope.osProjectId !== "number") return null;
  return scope;
}

// The standalone (shared-password) session. Previously this cookie's value was
// the APP_SESSION_TOKEN constant and admin was flagged by a SECOND cookie holding
// the SAME constant — so any logged-in user could copy their session cookie into
// an sms_admin cookie and become admin. Admin is now a signed claim inside the
// one session cookie: unforgeable without the signing key, and there is no second
// cookie to copy anything into.
export type StandaloneSession = { admin: boolean; exp: number };

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function signSession(admin: boolean, nowSeconds: number): Promise<string> {
  return sign({ admin, exp: nowSeconds + SESSION_TTL_SECONDS } satisfies StandaloneSession);
}

export async function readSession(raw: string | undefined, nowSeconds: number): Promise<StandaloneSession | null> {
  const session = await readSigned<StandaloneSession>(raw, nowSeconds);
  if (!session) return null;
  // A tampered/absent admin flag is not admin, never the reverse.
  return { admin: session.admin === true, exp: session.exp };
}

export function scopeCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: true, // localhost is a secure context, so this costs dev nothing and cannot be lost to a missing NODE_ENV
    path: process.env.NEXT_PUBLIC_BASE_PATH || "/",
    maxAge: SCOPE_TTL_SECONDS,
  };
}

export function scopeFromRequest(req: Request, nowSeconds: number): Promise<ProjectScope | null> {
  return readScope(parseCookie(req, SCOPE_COOKIE), nowSeconds);
}

// Admin from either session kind: the standalone admin password, or an OS
// launch whose handed-down toolLevel is "admin". Takes raw cookie values so
// both route handlers (plain Request) and server components (next/headers)
// can call it — next/headers must not be imported here, this module also
// runs in edge middleware.
export async function isAdminFromCookies(
  sessionCookie: string | undefined,
  scopeCookie: string | undefined,
  nowSeconds: number
): Promise<boolean> {
  if ((await readSession(sessionCookie, nowSeconds))?.admin) return true;
  const scope = await readScope(scopeCookie, nowSeconds);
  return isToolAdmin(scope?.toolLevel);
}

// Route handlers receive a plain Request, not a NextRequest, and next/headers'
// cookies() requires Next's request-scoped context (absent when a test calls
// a route's exported handler directly) — so admin checks in routes parse the
// raw Cookie header instead.
export function isAdminRequest(req: Request): Promise<boolean> {
  return isAdminFromCookies(
    parseCookie(req, SESSION_COOKIE),
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
