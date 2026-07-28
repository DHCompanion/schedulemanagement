import { NextResponse } from "next/server";
import { dismissScope } from "@/lib/trades/tradesService";
import { denyOutOfScope, scopeFromRequest } from "@/lib/scope";

export async function POST(req: Request) {
  const body = (await req.json()) as { projectId?: string; canonicalScope?: string };
  if (!body.projectId || !body.canonicalScope) {
    return NextResponse.json({ error: { message: "projectId and canonicalScope required." } }, { status: 422 });
  }

  const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
  const denied = denyOutOfScope(scope, body.projectId);
  if (denied) return denied;
  try {
    await dismissScope(body.projectId, body.canonicalScope, undefined, scope?.personId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to dismiss.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
