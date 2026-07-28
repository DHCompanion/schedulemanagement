// Behind a platform proxy, a route handler's req.url can resolve to the internal
// bind address rather than the public host, so redirects built from it send
// browsers to a dead end. Derive the externally-visible origin from the
// forwarded headers instead. Middleware doesn't need this — req.nextUrl already
// carries the real host.
export function requestBaseUrl(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

// Next's basePath prefixes <Link> and router navigation, but NOT raw fetch()
// URLs or <form action> — those stay root-absolute and, behind the OS rewrite,
// would resolve against sgconnect.dev and hit the OS instead of this tool.
// Prefix them here. No-op when the tool runs standalone (BASE_PATH unset).
export function appPath(path: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}

// Absolute redirect target for route handlers. APP_BASE_URL wins when set:
// behind the OS same-domain rewrite the forwarded host is this deployment's own
// origin, so a redirect built from it would bounce the user out of the proxy and
// off sgconnect.dev. APP_BASE_URL already includes the base path.
export function appUrl(req: Request, path: string): string {
  const configured = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  if (!configured) return `${requestBaseUrl(req)}${appPath(path)}`;
  // A malformed value would otherwise surface as a bare ERR_INVALID_URL from
  // whichever redirect happened to run first, naming nothing.
  try {
    new URL(configured);
  } catch {
    throw new Error(`APP_BASE_URL is not a valid URL: ${configured}`);
  }
  return `${configured}${path}`;
}

// SKILES_OS_APP_ORIGIN is a comma-separated list of OS origins. One value was too
// rigid: the OS builds returnUrl from window.location.origin, production serves
// www while the apex redirects to it, and every launch 400d. Shared by the launch
// guard and the "back to Connect" link so they cannot drift.
export function osAppOrigins(): string[] {
  return (process.env.SKILES_OS_APP_ORIGIN ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
