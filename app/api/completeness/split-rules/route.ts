import { NextResponse } from "next/server";
import { addSplitRule, removeSplitRule } from "@/lib/completeness/splitRuleService";
import { isAdminRequest } from "@/lib/auth";

interface SplitRuleBody {
  coarseScope?: string;
  finerScope?: string;
}

function validate(body: SplitRuleBody): string | null {
  if (!body.coarseScope?.trim() || !body.finerScope?.trim()) return "coarseScope and finerScope are required.";
  return null;
}

export async function POST(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: { message: "Admin access required." } }, { status: 403 });
  const body = (await req.json()) as SplitRuleBody;
  const err = validate(body);
  if (err) return NextResponse.json({ error: { message: err } }, { status: 422 });
  try {
    await addSplitRule(body.coarseScope!, body.finerScope!);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}

export async function DELETE(req: Request) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: { message: "Admin access required." } }, { status: 403 });
  const body = (await req.json()) as SplitRuleBody;
  const err = validate(body);
  if (err) return NextResponse.json({ error: { message: err } }, { status: 422 });
  try {
    await removeSplitRule(body.coarseScope!, body.finerScope!);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to remove.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
