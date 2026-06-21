import { NextResponse } from "next/server";
import { dismissIssue } from "@/lib/completeness/completenessService";

interface DismissBody {
  projectId?: string;
  canonicalActivityKey?: string;
  coarseScope?: string;
  note?: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as DismissBody;
  if (!body.projectId || !body.canonicalActivityKey || !body.coarseScope) {
    return NextResponse.json({ error: { message: "projectId, canonicalActivityKey, and coarseScope are required." } }, { status: 422 });
  }
  try {
    await dismissIssue(body.projectId, body.canonicalActivityKey, body.coarseScope, undefined, body.note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to dismiss.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
