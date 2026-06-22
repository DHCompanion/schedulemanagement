import { NextResponse } from "next/server";
import { acceptSplit } from "@/lib/completeness/acceptSplit";

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
  try {
    const { newImportId } = await acceptSplit(body.projectId, body.canonicalActivityKey, body.coarseScope, body.acceptedBy);
    return NextResponse.json({ ok: true, newImportId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to accept.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
