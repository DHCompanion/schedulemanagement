import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { denyIfOutOfScope } from "@/lib/scope";
import { saveEntries, type EntryInput } from "@/lib/updates/updateService";

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
  const denied = await denyIfOutOfScope(req, update.projectId);
  if (denied) return denied;

  try {
    await saveEntries(params.updateId, body.entries ?? []);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
