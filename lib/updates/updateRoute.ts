import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { denyIfOutOfScope } from "@/lib/scope";
import { denyIfHistorical } from "@/lib/historical";
import { SaveRefused } from "@/lib/updates/updateService";

const error = (message: string, status: number) => NextResponse.json({ error: { message } }, { status });

/** The update names the project, not the request: resolve it before deciding whether this session may change it. */
export async function guardUpdate(req: Request, updateId: string): Promise<Response | null> {
  const update = await prisma.progressUpdate.findUnique({ where: { id: updateId }, select: { projectId: true } });
  if (!update) return error("Update not found.", 404);
  return (await denyIfOutOfScope(req, update.projectId)) ?? (await denyIfHistorical(update.projectId));
}

export const refusal = (e: unknown) => (e instanceof SaveRefused ? error(e.message, e.status) : error("Something went wrong. Try again.", 500));
