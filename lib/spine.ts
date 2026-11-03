// Schedule Manager's events on the Connect spine (POST /tool-gateway/activity-events). Connect turns them into a
// "finalize this update" task for the agent's person (agent_drafted) and closes it (finalized / discarded).
// Best effort: callers run this after the response, and a failure is logged, never thrown.
import { call, mintServiceToken } from "@/lib/os-gateway";
import { prisma } from "@/lib/db";
import type { SavedWrite } from "@/lib/gateway/writes";

export type UpdateEvent = {
  osProjectId: number | null;
  eventType: `schedule-manager.update.${"agent_drafted" | "finalized" | "discarded"}`;
  updateId: string;
  summary: string;
  payload?: Record<string, unknown>;
};

export async function emitUpdateEvent(e: UpdateEvent): Promise<void> {
  if (e.osProjectId == null) return; // not a Connect project: nothing to tell
  try {
    const token = await mintServiceToken(e.osProjectId);
    await call("/activity-events", token, {
      method: "POST",
      body: JSON.stringify({
        eventType: e.eventType, sourceRecordId: e.updateId, idempotencyKey: `${e.eventType.split(".").pop()}:${e.updateId}`,
        subjectType: "progress_update", subjectId: e.updateId, summary: e.summary, payload: e.payload,
      }),
    });
  } catch (err) {
    console.error(`[schedule-manager] ${e.eventType} event skipped:`, err instanceof Error ? err.message : err);
  }
}

/** After a saved agent write: the update that write landed in (not whichever draft is open now, which a replay or a
 * finalize-and-reopen could change), only while it is still a draft. Keyed so every write to one draft makes one task. */
export async function emitAgentDrafted({ osProjectId, requestId, who, idempotencyKey, data }: SavedWrite): Promise<void> {
  try {
    const write = await prisma.agentWrite.findUnique({
      where: { personId_agentId_idempotencyKey: { personId: who.personId, agentId: who.agentId, idempotencyKey } },
      select: { progressUpdate: { select: { id: true, state: true } } },
    });
    const draft = write?.progressUpdate;
    if (draft?.state !== "draft") return;
    const n = data.activities.length;
    await emitUpdateEvent({
      osProjectId, eventType: "schedule-manager.update.agent_drafted", updateId: draft.id,
      summary: `Your agent saved ${n} ${n === 1 ? "activity" : "activities"} to the ${data.asOfDate} draft update`,
      payload: { requestId, asOfDate: data.asOfDate, activityCount: n },
    });
  } catch (err) {
    console.error("[schedule-manager] agent_drafted event skipped:", err instanceof Error ? err.message : err);
  }
}
