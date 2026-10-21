import { prisma } from "@/lib/db";
import { toDbDate } from "@/lib/import/commitImport";
import { carryProgressThroughSplits, type FinalizedEntry } from "@/lib/lookahead/currentProgress";
import type { ActivityProgress, ProgressStatus } from "@/lib/lookahead/computeLookahead";

export interface EntryInput {
  activityExternalUid: number;
  canonicalActivityKey: string;
  status: string;
  actualStart: string | null;
  actualFinish: string | null;
  percentComplete: number | null;
  note: string | null;
  forecastStart?: string | null;
  forecastFinish?: string | null;
}

function isMeaningful(e: EntryInput): boolean {
  return (
    e.status !== "not_started" ||
    !!e.forecastStart ||
    !!e.forecastFinish ||
    !!e.actualStart ||
    !!e.actualFinish ||
    e.percentComplete != null ||
    (e.note?.trim().length ?? 0) > 0
  );
}

type StoredEntry = Pick<FinalizedEntry, "canonicalActivityKey" | "status" | "actualStart" | "actualFinish" | "percentComplete" | "note" | "forecastStart" | "forecastFinish">;

/** Carry-forward progress overridden by one update's own entries — what that update would finalize. */
export function overlayEntries(carry: Map<string, ActivityProgress>, entries: StoredEntry[]): Map<string, ActivityProgress> {
  const out = new Map(carry);
  for (const e of entries) {
    out.set(e.canonicalActivityKey, {
      status: e.status as ProgressStatus,
      actualStart: e.actualStart,
      actualFinish: e.actualFinish,
      percentComplete: e.percentComplete,
      note: e.note,
      forecastStart: e.forecastStart ?? null,
      forecastFinish: e.forecastFinish ?? null,
    });
  }
  return out;
}

/** Unsaved form entries in stored shape, dropping the ones saveEntries would drop. */
export function storedShape(entries: EntryInput[]): StoredEntry[] {
  return entries.filter(isMeaningful).map((e) => ({
    canonicalActivityKey: e.canonicalActivityKey,
    status: e.status,
    actualStart: toDbDate(e.actualStart),
    actualFinish: toDbDate(e.actualFinish),
    percentComplete: e.percentComplete,
    note: e.note,
    forecastStart: toDbDate(e.forecastStart ?? null),
    forecastFinish: toDbDate(e.forecastFinish ?? null),
  }));
}

/** One draft per project: return the existing draft, else create one against the latest import. */
export async function getOrCreateDraft(
  projectId: string,
  asOfDate: string,
  lookaheadWeeks: number,
  personId?: number | null,
): Promise<{ id: string }> {
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
      personId: personId ?? null,
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
          forecastStart: toDbDate(e.forecastStart ?? null),
          forecastFinish: toDbDate(e.forecastFinish ?? null),
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
  const splits = await prisma.completenessSplit.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  const entries = updates.flatMap((u) =>
    u.entries.map((e) => ({
      canonicalActivityKey: e.canonicalActivityKey,
      finalizedAt: (u.finalizedAt ?? u.updatedAt) as Date,
      status: e.status,
      actualStart: e.actualStart,
      actualFinish: e.actualFinish,
      percentComplete: e.percentComplete,
      note: e.note,
      forecastStart: e.forecastStart,
      forecastFinish: e.forecastFinish,
    })),
  );
  return carryProgressThroughSplits(
    entries,
    splits.map((sp) => ({ coarseWbsCode: sp.coarseWbsCode, coarseName: sp.coarseName, finerScopes: sp.finerScopes as string[] })),
  );
}
