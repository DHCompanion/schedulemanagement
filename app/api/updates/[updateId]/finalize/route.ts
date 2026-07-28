import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { denyIfOutOfScope } from "@/lib/scope";
import { finalizeUpdate } from "@/lib/updates/updateService";

export async function POST(req: Request, { params }: { params: { updateId: string } }) {
  // The update names the project, not the request — resolve it before deciding
  // whether this session may finalize it.
  const update = await prisma.progressUpdate.findUnique({
    where: { id: params.updateId },
    select: { projectId: true },
  });
  if (!update) return NextResponse.json({ error: { message: "Update not found." } }, { status: 404 });
  const denied = await denyIfOutOfScope(req, update.projectId);
  if (denied) return denied;

  try {
    await finalizeUpdate(params.updateId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to finalize.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
