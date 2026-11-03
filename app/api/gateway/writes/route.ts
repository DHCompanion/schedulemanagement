import { createPublicKey } from "node:crypto";
import { after } from "next/server";
import { handleGatewayWrite } from "@/lib/gateway/writes";
import { saveAgentDraft } from "@/lib/gateway/draftWrite";
import { emitAgentDrafted } from "@/lib/spine";

export const dynamic = "force-dynamic";

// POST /<BASE_PATH>/api/gateway/writes — Connect's signed agent draft write (lib/gateway/writes.ts).
// Public in the middleware allowlist: the Ed25519 signature is the only credential.
// Off unless SCHEDULE_MANAGER_GATEWAY_WRITES_ENABLED=true; uses the read's Connect origin and key.
export async function POST(request: Request) {
  const raw = await request.text(); // RAW bytes before parse — the signature covers them
  try {
    const origin = new URL(process.env.SCHEDULE_MANAGER_GATEWAY_CONNECT_ORIGIN ?? "");
    if (process.env.SCHEDULE_MANAGER_GATEWAY_WRITES_ENABLED !== "true" || origin.protocol !== "https:" || origin.origin !== origin.href.replace(/\/$/, "")) throw Error();
    const publicKey = createPublicKey(process.env.SCHEDULE_MANAGER_GATEWAY_CONNECT_PUBLIC_KEY ?? "");
    if (publicKey.asymmetricKeyType !== "ed25519") throw Error();
    return await handleGatewayWrite(raw, request.headers.get("X-Connect-Read-Signature"), { publicKey, connectOrigin: origin.origin, save: saveAgentDraft,
      afterSave: (projectId, requestId, data) => after(() => emitAgentDrafted(projectId, requestId, data)),
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
