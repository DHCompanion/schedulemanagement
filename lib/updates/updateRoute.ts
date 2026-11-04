import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { denyIfOutOfScope } from "@/lib/scope";
import { denyIfHistorical } from "@/lib/historical";
import { SaveRefused } from "@/lib/updates/updateService";
import type { UpdateEvent } from "@/lib/spine";

const error = (message: string, status: number) => NextResponse.json({ error: { message } }, { status });

/** The update names the project, not the request: resolve it before deciding whether this session may change it. */
export async function guardUpdate(req: Request, updateId: string): Promise<Response | null> {
  const update = await prisma.progressUpdate.findUnique({ where: { id: updateId }, select: { projectId: true } });
  if (!update) return error("Update not found.", 404);
  return (await denyIfOutOfScope(req, update.projectId)) ?? (await denyIfHistorical(update.projectId));
}

export const refusal = (e: unknown) => (e instanceof SaveRefused ? error(e.message, e.status) : error("Something went wrong. Try again.", 500));

/** The spine event for closing an update, read before the change (a discard deletes the row). */
export async function closedEvent(updateId: string, kind: "finalized" | "discarded"): Promise<UpdateEvent> {
  const u = await prisma.progressUpdate.findUniqueOrThrow({ where: { id: updateId }, select: { asOfDate: true, project: { select: { osProjectId: true } } } });
  const date = u.asOfDate.toISOString().slice(0, 10);
  return {
    osProjectId: u.project.osProjectId, eventType: `schedule-manager.update.${kind}`, updateId,
    summary: kind === "finalized" ? `Schedule update for ${date} finalized` : `Draft schedule update for ${date} discarded`,
  };
}
