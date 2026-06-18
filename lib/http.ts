// Behind Railway's proxy, a route handler's req.url resolves to the internal
// bind address (localhost:8080), so redirects built from it send browsers to a
// dead end. Derive the externally-visible origin from the forwarded headers
// instead. Middleware doesn't need this — req.nextUrl already carries the real
// host.
export function requestBaseUrl(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}
