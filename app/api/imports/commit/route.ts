import { NextResponse } from "next/server";
import { readUploadedXml } from "@/lib/http";
import { prisma } from "@/lib/db";
import { commitImport } from "@/lib/import/commitImport";
import { reapplySplits } from "@/lib/import/reimportPreview";
import { denyOutOfScope, scopeFromRequest } from "@/lib/scope";
import { denyIfHistorical } from "@/lib/historical";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  const statusDate = String(form.get("statusDate") ?? "").trim() || null;
  if (!(file instanceof File) || !projectId) {
    return NextResponse.json({ error: { message: "file and projectId are required." } }, { status: 400 });
  }

  const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
  const denied = denyOutOfScope(scope, projectId) ?? (await denyIfHistorical(projectId));
  if (denied) return denied;
  const upload = await readUploadedXml(file);
  if ("error" in upload) {
    return NextResponse.json({ error: { message: upload.error } }, { status: 413 });
  }
  const { xml } = upload;
  try {
    const { id } = await commitImport({
      projectId,
      fileName: file.name,
      xml,
      statusDateOverride: statusDate,
      personId: scope?.personId,
    });
    // Not atomic with the import: a failed re-split must not read as a failed
    // import (a retry would import twice), so it is reported alongside the id.
    let resplit: string[] = [];
    let resplitError: string | undefined;
    if (form.get("reapplySplits") === "1") {
      try {
        resplit = await reapplySplits(projectId, scope?.personId);
      } catch (e) {
        resplitError = `Imported, but re-applying splits failed: ${e instanceof Error ? e.message : "unknown error"}. Finish them from Completeness.`;
      }
    }
    const [importCount, project] = await Promise.all([
      prisma.scheduleImport.count({ where: { projectId } }),
      prisma.project.findUnique({ where: { id: projectId }, select: { onboardingCompletedAt: true } }),
    ]);
    const startWizard = importCount === 1 && !project?.onboardingCompletedAt;
    return NextResponse.json({ id, startWizard, resplit, resplitError });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to import.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
