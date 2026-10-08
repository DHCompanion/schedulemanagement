import { NextResponse } from "next/server";
import { markNotCoarse, unmarkNotCoarse } from "@/lib/completeness/splitRuleService";
import { isAdminRequest, scopeFromRequest } from "@/lib/scope";

// Admin-only, like the split rules: the mark is shared by every project.
async function handle(req: Request, mark: boolean) {
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: { message: "Admin access required." } }, { status: 403 });
  const body = (await req.json()) as { name?: string };
  if (!body.name?.trim()) return NextResponse.json({ error: { message: "name is required." } }, { status: 422 });
  try {
    if (mark) {
      const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
      await markNotCoarse(body.name, scope?.personId);
    } else {
      await unmarkNotCoarse(body.name);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}

export const POST = (req: Request) => handle(req, true);
export const DELETE = (req: Request) => handle(req, false);
