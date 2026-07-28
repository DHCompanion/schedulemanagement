import { NextResponse } from "next/server";
import { restoreScope } from "@/lib/trades/tradesService";
import { denyIfOutOfScope } from "@/lib/scope";

export async function POST(req: Request) {
  const body = (await req.json()) as { projectId?: string; canonicalScope?: string };
  if (!body.projectId || !body.canonicalScope) {
    return NextResponse.json({ error: { message: "projectId and canonicalScope required." } }, { status: 422 });
  }

  const denied = await denyIfOutOfScope(req, body.projectId);
  if (denied) return denied;
  try {
    await restoreScope(body.projectId, body.canonicalScope);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to restore.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
