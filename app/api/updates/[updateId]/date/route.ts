import { NextResponse } from "next/server";
import { guardUpdate, refusal } from "@/lib/updates/updateRoute";
import { changeDraftDate } from "@/lib/updates/updateService";

/** POST { asOfDate } — move the open draft's data date (same rules as the agent write). */
export async function POST(req: Request, props: { params: Promise<{ updateId: string }> }) {
  const { updateId } = await props.params;
  const denied = await guardUpdate(req, updateId);
  if (denied) return denied;
  const body: unknown = await req.json().catch(() => null);
  const asOfDate = body && typeof body === "object" ? (body as { asOfDate?: unknown }).asOfDate : null;
  try {
    await changeDraftDate(updateId, typeof asOfDate === "string" ? asOfDate : "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return refusal(e);
  }
}
