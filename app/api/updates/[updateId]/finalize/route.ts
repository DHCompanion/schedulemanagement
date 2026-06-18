import { NextResponse } from "next/server";
import { finalizeUpdate } from "@/lib/updates/updateService";

export async function POST(_req: Request, { params }: { params: { updateId: string } }) {
  try {
    await finalizeUpdate(params.updateId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to finalize.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
