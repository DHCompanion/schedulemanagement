// Connect's agent draft write (connect.schedule-manager.update_draft.write): fills the project's open draft weekly
// update from what the person told their agent. All or nothing, in one transaction: create or move the draft, refuse
// if anything the agent read has changed since, save through saveEntriesIn, record the write under its key.
// A person still reviews and finalizes the update in Schedule Manager.
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveForecastStatusDate } from "@/lib/forecast/resolveStatusDate";
import { SaveRefused, saveEntriesIn, type EntryInput } from "@/lib/updates/updateService";
import { day, draftView, parseDay } from "./updateState";

type Progress = { status: string; percentComplete: number | null; actualStart: string | null; actualFinish: string | null };
export type DraftWriteEntry = Progress & { key: string; expectedDraft: Progress | null };
export type DraftWriteInput = { projectId: number; idempotencyKey: string; asOfDate?: string; expectedDraftAsOfDate: string | null; entries: DraftWriteEntry[] };
export type DraftWriteResult = {
  saved: boolean; asOfDate: string | null; activities: string[];
  reason: "stale" | "invalid" | "finalized" | "no_schedule" | null; message: string | null;
};
export type Writer = { personId: number; agentId: string; clientKey: string };

const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(v);
const same = (a: Progress | null, b: Progress | null) => canonical(a) === canonical(b);

class Refused extends Error {
  constructor(readonly result: DraftWriteResult) { super(result.message ?? "refused"); }
}
const refuse = (reason: NonNullable<DraftWriteResult["reason"]>, message: string, activities: string[] = [], asOfDate: string | null = null): never => {
  throw new Refused({ saved: false, asOfDate, activities, reason, message });
};

/** Saves one agent write, or answers why not. A resend of a saved write returns its first answer. */
export async function saveAgentDraft(osProjectId: number, input: DraftWriteInput, who: Writer): Promise<DraftWriteResult> {
  const payloadHash = createHash("sha256").update(canonical(input)).digest("hex");
  const prior = () => prisma.agentWrite.findUnique({ where: { personId_agentId_idempotencyKey: { personId: who.personId, agentId: who.agentId, idempotencyKey: input.idempotencyKey } } });
  const answer = (row: { payloadHash: string; result: Prisma.JsonValue }): DraftWriteResult =>
    row.payloadHash === payloadHash ? (row.result as DraftWriteResult)
    : { saved: false, asOfDate: null, activities: [], reason: "invalid", message: "This idempotencyKey was already used for a different write. Use a new key." };
  const stored = await prior();
  if (stored) return answer(stored);
  try {
    return await prisma.$transaction((tx) => write(tx, osProjectId, input, who, payloadHash), { timeout: 15_000 });
  } catch (e) {
    if (e instanceof Refused) return e.result;
    if (e instanceof SaveRefused) return { saved: false, asOfDate: null, activities: [], reason: e.status === 409 ? "finalized" : "invalid", message: e.message };
    // The same write committed concurrently (a resend racing the first attempt), or someone started the draft.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await prior();
      if (raced) return answer(raced);
      return { saved: false, asOfDate: null, activities: [], reason: "stale", message: "Someone started this week's update just now. Read the update state again, then resend." };
    }
    throw e;
  }
}

async function write(tx: Prisma.TransactionClient, osProjectId: number, input: DraftWriteInput, who: Writer, payloadHash: string): Promise<DraftWriteResult> {
  const keys = input.entries.map((e) => e.key);
  const dates = [input.asOfDate, input.expectedDraftAsOfDate, ...input.entries.flatMap((e) => [e.actualStart, e.actualFinish, e.expectedDraft?.actualStart, e.expectedDraft?.actualFinish])];
  if (dates.some((d) => d != null && !parseDay(d))) refuse("invalid", "A date is not a real YYYY-MM-DD date.");
  if (new Set(keys).size !== keys.length) refuse("invalid", "The same activity was sent twice.");

  const project = await tx.project.findUnique({ where: { osProjectId }, select: { id: true } });
  const latest = project && await tx.scheduleImport.findFirst({ where: { projectId: project.id }, orderBy: { importedAt: "desc" }, select: { id: true, statusDate: true, importedAt: true } });
  if (!project || !latest) return refuse("no_schedule", "This project has no schedule in Schedule Manager yet, so there is no update to fill.");

  const draft = await tx.progressUpdate.findFirst({ where: { projectId: project.id, state: "draft" }, select: { id: true, asOfDate: true, scheduleImportId: true } });
  if (day(draft?.asOfDate) !== input.expectedDraftAsOfDate)
    refuse("stale", draft ? `The draft update's data date is now ${day(draft.asOfDate)}. Read the update state again, then resend.` : "The draft update was finalized or removed since you read it. Read the update state again, then resend.", [], day(draft?.asOfDate));
  const target = input.asOfDate ?? day(draft?.asOfDate) ?? day(await resolveForecastStatusDate(project.id, latest))!;
  const finalized = await tx.progressUpdate.findFirst({ where: { projectId: project.id, state: "finalized" }, orderBy: { asOfDate: "desc" }, select: { asOfDate: true } });
  if (finalized && target <= day(finalized.asOfDate)!)
    refuse("invalid", `The data date must be after the last finalized update (${day(finalized.asOfDate)}).`, [], day(draft?.asOfDate));

  // Creating races the one-open-draft index; the loser answers "stale" (see saveAgentDraft).
  const updateId = draft?.id ?? (await tx.progressUpdate.create({
    data: { projectId: project.id, scheduleImportId: latest.id, asOfDate: parseDay(target)!, lookaheadWeeks: 3, state: "draft", personId: who.personId },
    select: { id: true },
  })).id;
  // Locks the draft (as saveEntriesIn does) before anything is compared.
  const open = await tx.progressUpdate.updateMany({ where: { id: updateId, state: "draft" }, data: { asOfDate: parseDay(target)! } });
  if (!open.count) refuse("finalized", "This update was finalized and can no longer be edited.");

  const current = await tx.progressEntry.findMany({ where: { progressUpdateId: updateId } });
  const byKey = new Map(current.map((e) => [e.canonicalActivityKey, e]));
  const stale = input.entries.filter((e) => { const c = byKey.get(e.key); return !same(c ? draftView(c) : null, e.expectedDraft); }).map((e) => e.key);
  if (stale.length)
    refuse("stale", `${stale.length === 1 ? "1 activity was" : `${stale.length} activities were`} changed in Schedule Manager since you read them. Read the update state again; nothing was saved.`, stale, day(draft?.asOfDate));

  // No progress recorded after the date the update is "as of", whether sent now or already in the draft.
  const late = [
    ...input.entries.filter((e) => [e.actualStart, e.actualFinish].some((d) => d && d > target)).map((e) => e.key),
    ...current.filter((c) => !keys.includes(c.canonicalActivityKey) && [c.actualStart, c.actualFinish].some((d) => d && day(d)! > target)).map((c) => c.canonicalActivityKey),
  ];
  if (late.length)
    refuse("invalid", `Actual dates can't be after the data date ${target}. Change those dates or the data date.`, late.slice(0, 15), day(draft?.asOfDate));

  const activities = new Map((await tx.activity.findMany({
    where: { scheduleImportId: draft?.scheduleImportId ?? latest.id, canonicalActivityKey: { in: keys } },
    select: { externalUid: true, canonicalActivityKey: true },
  })).map((a) => [a.canonicalActivityKey, a.externalUid]));
  const missing = keys.filter((k) => !activities.has(k));
  if (missing.length) refuse("invalid", "Some activities are not in this update's schedule. Read the update state again.", missing, day(draft?.asOfDate));

  // The agent never sends notes or forecasts: keep what the entry already has.
  const entries: EntryInput[] = input.entries.map((e) => {
    const c = byKey.get(e.key);
    return {
      activityExternalUid: activities.get(e.key)!, canonicalActivityKey: e.key, status: e.status,
      actualStart: e.actualStart, actualFinish: e.actualFinish, percentComplete: e.percentComplete,
      note: c?.note ?? null, forecastStart: day(c?.forecastStart), forecastFinish: day(c?.forecastFinish),
      expectedVersion: c ? c.updatedAt.toISOString() : null,
    };
  });
  await saveEntriesIn(tx, updateId, entries, who.personId);

  const result: DraftWriteResult = { saved: true, asOfDate: target, activities: keys, reason: null, message: null };
  await tx.agentWrite.create({
    data: { ...who, idempotencyKey: input.idempotencyKey, payloadHash, progressUpdateId: updateId, fromAsOfDate: draft?.asOfDate ?? null, result },
  });
  return result;
}
