import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toDbDate } from "@/lib/import/commitImport";
import { carryProgressThroughSplits, type FinalizedEntry } from "@/lib/lookahead/currentProgress";
import type { ActivityProgress, ProgressStatus } from "@/lib/lookahead/computeLookahead";
import { dataDateProblem, parseDay } from "@/lib/updates/dataDate";

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
  /** The entry's updatedAt (ISO) when the caller loaded it; null when it had no entry. */
  expectedVersion?: string | null;
}

/** A save the server refused; `status` is the HTTP status the route returns. */
export class SaveRefused extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const STATUSES = new Set(["not_started", "in_progress", "complete"]);
const badDate = (s: unknown) => s != null && s !== "" && (typeof s !== "string" || Number.isNaN(toDbDate(s)!.getTime()));
const malformed = (e: EntryInput) =>
  typeof e?.canonicalActivityKey !== "string" || typeof e.activityExternalUid !== "number" || typeof e.status !== "string" ||
  (e.note != null && typeof e.note !== "string") || (e.percentComplete != null && typeof e.percentComplete !== "number");

/** Why one entry can't be saved, or null. `activity` is the draft-import activity with its key. */
export function entryProblem(e: EntryInput, activity: { externalUid: number; canonicalActivityKey: string } | undefined): string | null {
  if (!activity || activity.externalUid !== e.activityExternalUid) return "is not in this update's schedule.";
  if (e.expectedVersion === undefined) return "was sent without its version. Reload the update and try again.";
  if (!STATUSES.has(e.status)) return "has an unknown status.";
  if (e.percentComplete != null && !(Number.isInteger(e.percentComplete) && e.percentComplete >= 0 && e.percentComplete <= 100))
    return "% complete must be a whole number 0–100.";
  if ([e.actualStart, e.actualFinish, e.forecastStart, e.forecastFinish].some(badDate)) return "has an invalid date.";
  if (e.status === "in_progress" && !e.actualStart) return "is in progress but has no actual start.";
  if (e.status === "complete" && !e.actualFinish) return "is complete but has no actual finish.";
  if (e.actualStart && e.actualFinish && toDbDate(e.actualFinish)! < toDbDate(e.actualStart)!) return "has an actual finish before its actual start.";
  return null;
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
  const early = await dataDateProblem(prisma, projectId, asOfDate, []);
  if (early) throw new SaveRefused(early.message, 422);
  try {
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
  } catch (e) {
    // A concurrent start won the one-open-draft index; use its draft.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    const winner = await prisma.progressUpdate.findFirst({ where: { projectId, state: "draft" } });
    if (!winner) throw e;
    return { id: winner.id };
  }
}

/**
 * Saves only the activities sent: a meaningful entry is written, an emptied one is removed,
 * and unsent activities are untouched. Refused whole (nothing written) if any entry is invalid
 * or changed since the caller loaded it.
 */
export async function saveEntries(updateId: string, entries: EntryInput[], personId: number | null = null): Promise<void> {
  await prisma.$transaction((tx) => saveEntriesIn(tx, updateId, entries, personId));
}

/** saveEntries inside the caller's transaction, so other draft changes commit or roll back with it. */
export async function saveEntriesIn(tx: Prisma.TransactionClient, updateId: string, entries: EntryInput[], personId: number | null): Promise<void> {
  // Locks the draft row, so saves and finalize on one draft run one at a time.
  const open = await tx.progressUpdate.updateMany({ where: { id: updateId, state: "draft" }, data: { updatedAt: new Date() } });
  const update = await tx.progressUpdate.findUnique({ where: { id: updateId }, select: { scheduleImportId: true } });
  if (!update) throw new SaveRefused("Update not found.", 404);
  if (!open.count) throw new SaveRefused("This update is finalized and can no longer be edited.", 409);
  const { scheduleImportId } = update;
  if (entries.some(malformed)) throw new SaveRefused("An entry is malformed.", 422);
  const keys = entries.map((e) => e.canonicalActivityKey);
  if (new Set(keys).size !== keys.length) throw new SaveRefused("The same activity was sent twice.", 422);
  const activities = await tx.activity.findMany({
    where: { scheduleImportId, canonicalActivityKey: { in: keys } },
    select: { externalUid: true, canonicalActivityKey: true, name: true },
  });
  const byKey = new Map(activities.map((a) => [a.canonicalActivityKey, a]));
  const problems = entries.flatMap((e) => {
    const p = entryProblem(e, byKey.get(e.canonicalActivityKey));
    return p ? [`${byKey.get(e.canonicalActivityKey)?.name ?? e.canonicalActivityKey} ${p}`] : [];
  });
  if (problems.length) throw new SaveRefused(problems.join(" "), 422);

  const existing = new Map((await tx.progressEntry.findMany({
    where: { progressUpdateId: updateId, canonicalActivityKey: { in: keys } },
    select: { canonicalActivityKey: true, updatedAt: true },
  })).map((x) => [x.canonicalActivityKey, x.updatedAt.toISOString()]));
  const stale = entries.filter((e) => (existing.get(e.canonicalActivityKey) ?? null) !== e.expectedVersion);
  if (stale.length) {
    const names = stale.map((e) => byKey.get(e.canonicalActivityKey)!.name).join(", ");
    throw new SaveRefused(
      `${stale.length === 1 ? "1 activity was" : `${stale.length} activities were`} changed by someone else since you opened this update: ${names}. Reload to see the changes. Nothing was saved.`,
      409,
    );
  }

  // Versions are checked under the draft lock, so replacing the sent rows is safe; two round trips for any size.
  await tx.progressEntry.deleteMany({ where: { progressUpdateId: updateId, canonicalActivityKey: { in: keys } } });
  await tx.progressEntry.createMany({
    data: entries.filter(isMeaningful).map((e) => ({
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
      changedByPersonId: personId,
    })),
  });
}

/** Moves an open draft's data date, under the agent write's rules (lib/updates/dataDate.ts). */
export async function changeDraftDate(updateId: string, asOfDate: string): Promise<void> {
  const date = parseDay(asOfDate);
  if (!date) throw new SaveRefused("Enter a real date.", 422);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ProgressUpdate" WHERE id = ${updateId} FOR UPDATE`;
    const update = await tx.progressUpdate.findUnique({ where: { id: updateId }, include: { entries: true } });
    if (!update) throw new SaveRefused("Update not found.", 404);
    if (update.state !== "draft") throw new SaveRefused("This update is finalized and can no longer be edited.", 409);
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const problem = await dataDateProblem(tx, update.projectId, asOfDate, update.entries.map((e) => ({ key: e.canonicalActivityKey, actualStart: day(e.actualStart), actualFinish: day(e.actualFinish) })));
    if (problem) {
      const names = (await tx.activity.findMany({ where: { scheduleImportId: update.scheduleImportId, canonicalActivityKey: { in: problem.keys } }, select: { name: true } })).map((a) => a.name);
      throw new SaveRefused(names.length ? `${problem.message} (${names.join(", ")})` : problem.message, 422);
    }
    await tx.progressUpdate.update({ where: { id: updateId }, data: { asOfDate: date } });
  });
}

/** Deletes an open draft with its entries and agent writes. A finalized update is history and stays. */
export async function discardDraft(updateId: string): Promise<void> {
  const done = await prisma.progressUpdate.deleteMany({ where: { id: updateId, state: "draft" } });
  if (done.count) return;
  const exists = await prisma.progressUpdate.findUnique({ where: { id: updateId }, select: { id: true } });
  throw new SaveRefused(exists ? "A finalized update can't be discarded." : "Update not found.", exists ? 409 : 404);
}

export async function finalizeUpdate(updateId: string): Promise<void> {
  const done = await prisma.progressUpdate.updateMany({ where: { id: updateId, state: "draft" }, data: { state: "finalized", finalizedAt: new Date() } });
  if (done.count) return;
  const exists = await prisma.progressUpdate.findUnique({ where: { id: updateId }, select: { id: true } });
  throw new Error(exists ? "This update is already finalized." : "Update not found.");
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
