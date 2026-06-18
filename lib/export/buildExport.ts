import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { resolveCurrentProgress } from "@/lib/lookahead/currentProgress";
import { getFinalizedEntries } from "@/lib/updates/updateService";
import { injectActuals, type ProgressForExport } from "@/lib/export/injectActuals";
import { parseForExport, buildMspdi } from "@/lib/export/serializeMspdi";
import { toMspdiDate } from "@/lib/export/mspdiDate";

export async function buildExport(
  projectId: string,
  uploadedXml: string,
  uploadedFileName: string,
): Promise<{ fileName: string; xml: string }> {
  const fileHash = crypto.createHash("sha256").update(uploadedXml).digest("hex");

  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  if (!latest) throw new Error("No imported schedule to export.");
  if (latest.fileHash !== fileHash) {
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

  const doc = parseForExport(uploadedXml);
  injectActuals(doc, progressByUid);
  const project = doc.Project as Record<string, unknown> | undefined;
  if (project && latestUpdate) project.StatusDate = toMspdiDate(latestUpdate.asOfDate);
  const xml = buildMspdi(doc);

  const asOf = (latestUpdate?.asOfDate ?? new Date()).toISOString().slice(0, 10);
  const base = uploadedFileName.replace(/\.xml$/i, "");
  return { fileName: `${base}-updated-${asOf}.xml`, xml };
}
