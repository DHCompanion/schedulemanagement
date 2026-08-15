import { NextResponse } from "next/server";
import { sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { checkPassword, checkAdminPassword } from "@/lib/password";
import { appUrl } from "@/lib/http";
import { signSession } from "@/lib/scope";

// Throttles password guessing per client IP. The whole app sits behind one
// shared password, so an unthrottled endpoint is a straight offline-speed online
// guessing target.
//
// ponytail: in-process Map, so the window is per serverless instance — it slows
// a single attacker meaningfully but does not bound a distributed or
// many-instance attack. Move to a shared store (a Postgres attempts table, or
// Upstash) if this tool is ever exposed beyond the OS proxy.
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

// Returns true when this IP has already used up its window.
function isRateLimited(ip: string, now: number): boolean {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip: string, now: number): void {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export async function POST(req: Request) {
  const now = Date.now();
  const ip = clientIp(req);
  if (isRateLimited(ip, now)) {
    // Same redirect as a wrong password: don't tell a guesser they found the
    // throttle, which would let them pace around it.
    return NextResponse.redirect(appUrl(req, "/login?error=1"), { status: 303 });
  }

  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const isAdminLogin = checkAdminPassword(password);
  if (!checkPassword(password) && !isAdminLogin) {
    recordFailure(ip, now);
    return NextResponse.redirect(appUrl(req, "/login?error=1"), { status: 303 });
  }
  // A correct password clears the window so one user's typos can't lock out a
  // shared office IP for the next person.
  attempts.delete(ip);
  // One signed cookie carrying the admin claim — not two cookies sharing a
  // constant, which let any user promote themselves by copying a value across.
  const session = await signSession(isAdminLogin, Math.floor(Date.now() / 1000));
  const res = NextResponse.redirect(appUrl(req, "/"), { status: 303 });
  res.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
  return res;
}
