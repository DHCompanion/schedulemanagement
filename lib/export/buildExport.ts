import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { injectActuals, injectNames, type ProgressForExport } from "@/lib/export/injectActuals";
import { parseForExport, buildMspdi } from "@/lib/export/serializeMspdi";
import { toMspdiDate } from "@/lib/export/mspdiDate";
import { applyDictionary } from "@/lib/normalize/normalizationService";
import { resolveExportBase } from "@/lib/completeness/acceptSplit";
import { injectSplits, type SplitForExport } from "@/lib/export/injectSplits";

export async function buildExport(
  projectId: string,
  uploadedXml: string,
  uploadedFileName: string,
): Promise<{ fileName: string; xml: string; deletedTasks: { name: string; wbsCode: string | null }[] }> {
  const fileHash = crypto.createHash("sha256").update(uploadedXml).digest("hex");

  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  if (!latest) throw new Error("No imported schedule to export.");

  const { baseImport, splits } = await resolveExportBase(latest.id);
  if (baseImport.fileHash !== fileHash) {
    throw new Error("This file doesn't match the current imported schedule — export the file you most recently imported.");
  }

  const current = resolveCurrentProgress(await getFinalizedEntries(projectId));
  if (current.size === 0) throw new Error("No finalized progress to export yet.");

  const progressByUid = new Map<number, ProgressForExport>();
  for (const a of latest.activities) {
    const p = current.get(a.canonicalActivityKey);
    if (p) progressByUid.set(a.externalUid, { status: p.status, actualStart: p.actualStart, actualFinish: p.actualFinish, percentComplete: p.percentComplete });
  }

  const latestUpdate = await prisma.progressUpdate.findFirst({
    where: { projectId, state: "finalized" },
    orderBy: { asOfDate: "desc" },
  });

  const { mapped } = await applyDictionary(latest.activities);
  const nameByUid = new Map<number, string>();
  for (const { activity, canonicalScope } of mapped) {
    nameByUid.set(activity.externalUid, canonicalScope);
  }

  const doc = parseForExport(uploadedXml);
  const splitsForExport: SplitForExport[] = splits.map((s) => ({
    coarseExternalUid: s.coarseExternalUid,
    coarseWbsCode: s.coarseWbsCode,
    coarseOutlineNumber: s.coarseOutlineNumber,
    coarseOutlineLevel: s.coarseOutlineLevel,
    coarseDurationMinutes: s.coarseDurationMinutes,
    coarseStart: s.coarseStart,
    coarseFinish: s.coarseFinish,
    finerScopes: s.finerScopes as string[],
    mintedUids: s.mintedUids as number[],
  }));
  injectSplits(doc, splitsForExport);
  injectActuals(doc, progressByUid);
  injectNames(doc, nameByUid);
  const project = doc.Project as Record<string, unknown> | undefined;
  if (project && latestUpdate) project.StatusDate = toMspdiDate(latestUpdate.asOfDate);
  const xml = buildMspdi(doc);

  const asOf = (latestUpdate?.asOfDate ?? new Date()).toISOString().slice(0, 10);
  const base = uploadedFileName.replace(/\.xml$/i, "");
  const deletedTasks = splits.map((s) => ({ name: s.coarseName, wbsCode: s.coarseWbsCode }));
  return { fileName: `${base}-updated-${asOf}.xml`, xml, deletedTasks };
}
