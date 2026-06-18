import { NextResponse } from "next/server";
import { saveEntries, type EntryInput } from "@/lib/updates/updateService";

export async function POST(req: Request, { params }: { params: { updateId: string } }) {
  const body = (await req.json()) as { entries?: EntryInput[] };
  try {
    await saveEntries(params.updateId, body.entries ?? []);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
