import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/http";
import { denyOutOfScope, scopeFromRequest } from "@/lib/scope";
import { refreshProcurementRiskIfStale } from "@/lib/procurement/refresh";

// The "Sync procurement" button. Forces a fresh pull of the OS
// procurement_project_summary packet (maxAgeMs 0 bypasses the 10-minute
// page-load staleness gate), then bounces back to the project so the AT RISK
// pills re-render. refreshProcurementRiskIfStale never throws — a failed pull
// leaves the previous cache and its "as of" line in place.
export async function POST(req: Request) {
  const form = await req.formData();
  const projectId = String(form.get("projectId") ?? "");
  if (!projectId) return NextResponse.redirect(appUrl(req, "/"), { status: 303 });

  const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
  const denied = denyOutOfScope(scope, projectId);
  if (denied) return denied;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, osProjectId: true },
  });
  if (project) await refreshProcurementRiskIfStale(project, 0);

  return NextResponse.redirect(appUrl(req, `/projects/${projectId}`), { status: 303 });
}
