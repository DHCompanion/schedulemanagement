import { NextResponse, after } from "next/server";
import { emitUpdateEvent } from "@/lib/spine";
import { closedEvent, guardUpdate } from "@/lib/updates/updateRoute";
import { finalizeUpdate } from "@/lib/updates/updateService";

export async function POST(req: Request, props: { params: Promise<{ updateId: string }> }) {
  const params = await props.params;
  const denied = await guardUpdate(req, params.updateId);
  if (denied) return denied;

  try {
    const event = await closedEvent(params.updateId, "finalized");
    await finalizeUpdate(params.updateId);
    after(() => emitUpdateEvent(event));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to finalize.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
