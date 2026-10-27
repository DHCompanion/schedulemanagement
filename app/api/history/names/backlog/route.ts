import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/scope";
import { applyBacklogAction, approveHighConfidence, BACKLOG_KINDS, getBacklog, type BacklogAction } from "@/lib/normalize/nameBacklog";
import { normalizeName } from "@/lib/normalize/normalizeName";

const ACTIONS = new Set<string>(BACKLOG_KINDS);

// The /history/names backlog dialog: the next names to review, and one action per name.
export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return error("Admin access required.", 403);
  return NextResponse.json(await getBacklog());
}

export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) return error("Admin access required.", 403);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.approveHigh === true) return NextResponse.json({ approved: await approveHighConfidence() });
  const name = normalizeName(String(body?.name ?? ""));
  const action = String(body?.action ?? "");
  if (!name || !ACTIONS.has(action)) return error("name and a valid action are required.", 422);
  if ((action === "map" || action === "new") && !String(body?.scope ?? "").trim()) return error("Pick a standard name.", 422);
  try {
    await applyBacklogAction({ name, action, scope: String(body?.scope ?? ""), covers: Array.isArray(body?.covers) ? body.covers.map(String) : [] } as BacklogAction);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Failed to save.", 422);
  }
  return NextResponse.json({ ok: true });
}

function error(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}
