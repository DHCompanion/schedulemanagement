import { NextResponse } from "next/server";
import { acceptSplit } from "@/lib/completeness/acceptSplit";
import { denyOutOfScope, scopeFromRequest } from "@/lib/scope";

interface AcceptBody {
  projectId?: string;
  canonicalActivityKey?: string;
  coarseScope?: string;
  acceptedBy?: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as AcceptBody;
  if (!body.projectId || !body.canonicalActivityKey || !body.coarseScope) {
    return NextResponse.json(
      { error: { message: "projectId, canonicalActivityKey, and coarseScope are required." } },
      { status: 422 },
    );
  }

  // body.acceptedBy is a client-supplied label, not identity — the verified
  // person comes off the signed scope.
  const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
  const denied = denyOutOfScope(scope, body.projectId);
  if (denied) return denied;

  try {
    const { newImportId } = await acceptSplit(
      body.projectId,
      body.coarseScope,
      body.acceptedBy,
      scope?.personId,
    );
    return NextResponse.json({ ok: true, newImportId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to accept.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
