// GET /<BASE_PATH>/api/health — the OS manifest's launch.healthCheckUrl hits
// this, unauthenticated (middleware lets it through). It must answer UNDER the
// base path: verify with a direct origin hit before go-live, i.e.
// https://<tool-origin>/schedule-manager/api/health -> 200, not the root path.
export function GET() {
  return Response.json({ status: "ok" });
}
