import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, isAuthed } from "@/lib/auth";
import { SCOPE_COOKIE, readScope } from "@/lib/scope";

// Reached before a session exists: the login form, the OS launch handoff (which
// mints the session), the health check the OS polls, and the context callback
// the OS makes server-to-server. Paths here are base-path-stripped — Next
// removes BASE_PATH before middleware sees them.
//
// /api/os-context is authenticated, just not by a cookie: it carries an HMAC
// signature the route verifies. Without it here every OS callback would be
// redirected to /login, and the OS would report this tool unreachable.
const PUBLIC_PATHS = ["/login", "/api/login", "/launch", "/api/health", "/api/os-context"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Two session kinds: a scoped OS session, or the shared-password session used
  // standalone. Either authenticates; only the first restricts what is visible.
  const scope = await readScope(req.cookies.get(SCOPE_COOKIE)?.value, Math.floor(Date.now() / 1000));
  if (!scope && !isAuthed(req.cookies.get(SESSION_COOKIE)?.value)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // URL-level project scoping. Every page lives under /projects/<id>, so one
  // check here covers all of them; API routes carry the project in the body and
  // are guarded individually (lib/scope.ts denyIfOutOfScope).
  if (scope && !pathname.startsWith("/api/")) {
    const requested = pathname.match(/^\/projects\/([^/]+)/)?.[1];
    const outOfScope = requested ? requested !== scope.projectId : pathname === "/";
    if (outOfScope) {
      const url = req.nextUrl.clone();
      url.pathname = `/projects/${scope.projectId}`;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

// "/" must be listed on its own: under BASE_PATH the bare base path (no trailing
// slash) does not match the catch-all pattern, and middleware is skipped
// entirely — which served the project list to anonymous requests.
export const config = { matcher: ["/", "/((?!_next/static|_next/image|favicon.ico).*)"] };
