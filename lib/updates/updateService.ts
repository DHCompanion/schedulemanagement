import { prisma } from "@/lib/db";
import { toDbDate } from "@/lib/import/commitImport";
import type { FinalizedEntry } from "@/lib/lookahead/currentProgress";

export interface EntryInput {
  activityExternalUid: number;
  canonicalActivityKey: string;
  status: string;
  actualStart: string | null;
  actualFinish: string | null;
  percentComplete: number | null;
  note: string | null;
}

function isMeaningful(e: EntryInput): boolean {
  return (
    e.status !== "not_started" ||
    !!e.actualStart ||
    !!e.actualFinish ||
    e.percentComplete != null ||
    (e.note?.trim().length ?? 0) > 0
  );
}

/** One draft per project: return the existing draft, else create one against the latest import. */
export async function getOrCreateDraft(projectId: string, asOfDate: string, lookaheadWeeks: number): Promise<{ id: string }> {
  const existing = await prisma.progressUpdate.findFirst({ where: { projectId, state: "draft" } });
  if (existing) return { id: existing.id };
  const latest = await prisma.scheduleImport.findFirst({ where: { projectId }, orderBy: { importedAt: "desc" } });
  if (!latest) throw new Error("Cannot start an update: this project has no schedule import yet.");
  const created = await prisma.progressUpdate.create({
    data: {
      projectId,
      scheduleImportId: latest.id,
      asOfDate: toDbDate(asOfDate) ?? new Date(),
      lookaheadWeeks: [1, 3, 6].includes(lookaheadWeeks) ? lookaheadWeeks : 3,
      state: "draft",
    },
  });
  return { id: created.id };
}

export async function saveEntries(updateId: string, entries: EntryInput[]): Promise<void> {
  const update = await prisma.progressUpdate.findUnique({ where: { id: updateId } });
  if (!update) throw new Error("Update not found.");
  if (update.state !== "draft") throw new Error("This update is finalized and can no longer be edited.");
  const meaningful = entries.filter(isMeaningful);
  await prisma.$transaction(async (tx) => {
    await tx.progressEntry.deleteMany({ where: { progressUpdateId: updateId } });
    if (meaningful.length) {
      await tx.progressEntry.createMany({
        data: meaningful.map((e) => ({
          progressUpdateId: updateId,
          activityExternalUid: e.activityExternalUid,
          canonicalActivityKey: e.canonicalActivityKey,
          status: e.status,
          actualStart: toDbDate(e.actualStart),
          actualFinish: toDbDate(e.actualFinish),
          percentComplete: e.percentComplete,
          note: e.note,
        })),
      });
    }
  });
}

export async function finalizeUpdate(updateId: string): Promise<void> {
  const update = await prisma.progressUpdate.findUnique({ where: { id: updateId } });
  if (!update) throw new Error("Update not found.");
  if (update.state !== "draft") throw new Error("This update is already finalized.");
  await prisma.progressUpdate.update({ where: { id: updateId }, data: { state: "finalized", finalizedAt: new Date() } });
}

export async function getFinalizedEntries(projectId: string): Promise<FinalizedEntry[]> {
  const updates = await prisma.progressUpdate.findMany({
    where: { projectId, state: "finalized" },
    include: { entries: true },
  });
  return updates.flatMap((u) =>
    u.entries.map((e) => ({
      canonicalActivityKey: e.canonicalActivityKey,
      finalizedAt: (u.finalizedAt ?? u.updatedAt) as Date,
      status: e.status,
      actualStart: e.actualStart,
      actualFinish: e.actualFinish,
      percentComplete: e.percentComplete,
      note: e.note,
    })),
  );
}
