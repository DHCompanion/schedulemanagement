import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { denyOutOfScope, scopeFromRequest } from "@/lib/scope";
import { denyIfHistorical } from "@/lib/historical";
import { SaveRefused, saveEntries, type EntryInput } from "@/lib/updates/updateService";

export async function POST(req: Request, props: { params: Promise<{ updateId: string }> }) {
  const params = await props.params;
  const body = (await req.json()) as { entries?: EntryInput[] };

  // The update names the project, not the request — resolve it before deciding
  // whether this session may write to it.
  const update = await prisma.progressUpdate.findUnique({
    where: { id: params.updateId },
    select: { projectId: true },
  });
  if (!update) return NextResponse.json({ error: { message: "Update not found." } }, { status: 404 });
  const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
  const denied = denyOutOfScope(scope, update.projectId) ?? (await denyIfHistorical(update.projectId));
  if (denied) return denied;

  if (!Array.isArray(body.entries)) return NextResponse.json({ error: { message: "No entries were sent." } }, { status: 422 });
  try {
    await saveEntries(params.updateId, body.entries, scope?.personId ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof SaveRefused) return NextResponse.json({ error: { message: e.message } }, { status: e.status });
    return NextResponse.json({ error: { message: "Failed to save." } }, { status: 500 });
  }
}
