import { NextResponse } from "next/server";
import { requestStandardScope } from "@/lib/normalize/normalizationService";
import { denyOutOfScope, scopeFromRequest } from "@/lib/scope";
import { denyIfHistorical } from "@/lib/historical";

// "Request as new name": anyone on the project can ask; only an admin adds a
// name to the standard list (/history/names).
export async function POST(req: Request) {
  const body = (await req.json()) as { projectId?: string; rawName?: string };
  if (!body.projectId || !body.rawName?.trim()) {
    return NextResponse.json({ error: { message: "projectId and rawName are required." } }, { status: 422 });
  }
  const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
  const denied = denyOutOfScope(scope, body.projectId) ?? (await denyIfHistorical(body.projectId));
  if (denied) return denied;
  await requestStandardScope(body.rawName, { projectId: body.projectId, personId: scope?.personId, requestedBy: scope?.personName });
  return NextResponse.json({ ok: true });
}
