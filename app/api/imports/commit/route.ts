import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { commitImport } from "@/lib/import/commitImport";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  const statusDate = String(form.get("statusDate") ?? "").trim() || null;
  if (!(file instanceof File) || !projectId) {
    return NextResponse.json({ error: { message: "file and projectId are required." } }, { status: 400 });
  }
  const xml = await file.text();
  try {
    const { id } = await commitImport({ projectId, fileName: file.name, xml, statusDateOverride: statusDate });
    const [importCount, project] = await Promise.all([
      prisma.scheduleImport.count({ where: { projectId } }),
      prisma.project.findUnique({ where: { id: projectId }, select: { onboardingCompletedAt: true } }),
    ]);
    const startWizard = importCount === 1 && !project?.onboardingCompletedAt;
    return NextResponse.json({ id, startWizard });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to import.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
