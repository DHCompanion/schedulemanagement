import { after } from "next/server";
import { connectPublicKeys } from "@/lib/gateway/reads";
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
    const publicKeys = connectPublicKeys(process.env.SCHEDULE_MANAGER_GATEWAY_CONNECT_PUBLIC_KEY ?? "");
    return await handleGatewayWrite(raw, request.headers.get("X-Connect-Read-Signature"), { publicKeys, connectOrigin: origin.origin, save: saveAgentDraft,
      afterSave: (saved) => after(() => emitAgentDrafted(saved)),
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
