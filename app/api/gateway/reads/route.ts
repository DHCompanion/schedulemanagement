import { createPublicKey } from "node:crypto";
import { handleGatewayRead } from "@/lib/gateway/reads";
import { loadUpdateState } from "@/lib/gateway/updateState";

export const dynamic = "force-dynamic";

// POST /<BASE_PATH>/api/gateway/reads — Connect's signed agent read (lib/gateway/reads.ts).
// Public in the middleware allowlist: the Ed25519 signature is the only credential.
// Off unless SCHEDULE_MANAGER_GATEWAY_READS_ENABLED=true; missing or bad config stays closed.
export async function POST(request: Request) {
  const raw = await request.text(); // RAW bytes before parse — the signature covers them
  try {
    const origin = new URL(process.env.SCHEDULE_MANAGER_GATEWAY_CONNECT_ORIGIN ?? "");
    if (process.env.SCHEDULE_MANAGER_GATEWAY_READS_ENABLED !== "true" || origin.protocol !== "https:" || origin.origin !== origin.href.replace(/\/$/, "")) throw Error();
    const publicKey = createPublicKey(process.env.SCHEDULE_MANAGER_GATEWAY_CONNECT_PUBLIC_KEY ?? "");
    if (publicKey.asymmetricKeyType !== "ed25519") throw Error();
    return await handleGatewayRead(raw, request.headers.get("X-Connect-Read-Signature"), { publicKey, connectOrigin: origin.origin, load: loadUpdateState });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
