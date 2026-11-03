import { NextResponse } from "next/server";
import { guardUpdate } from "@/lib/updates/updateRoute";
import { finalizeUpdate } from "@/lib/updates/updateService";

export async function POST(req: Request, props: { params: Promise<{ updateId: string }> }) {
  const params = await props.params;
  const denied = await guardUpdate(req, params.updateId);
  if (denied) return denied;

  try {
    await finalizeUpdate(params.updateId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to finalize.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
