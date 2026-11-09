import { NextResponse, after } from "next/server";
import { emitUpdateEvent } from "@/lib/spine";
import { closedEvent, guardUpdate, refusal } from "@/lib/updates/updateRoute";
import { discardDraft } from "@/lib/updates/updateService";

/** POST — delete the open draft with its entries and agent writes. Finalized updates are refused. */
export async function POST(req: Request, props: { params: Promise<{ updateId: string }> }) {
  const { updateId } = await props.params;
  const denied = await guardUpdate(req, updateId);
  if (denied) return denied;
  try {
    const event = await closedEvent(updateId, "discarded");
    await discardDraft(updateId);
    after(() => emitUpdateEvent(event));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return refusal(e);
  }
}
