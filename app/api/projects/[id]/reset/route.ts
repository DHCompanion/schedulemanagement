import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/http";
import { denyIfOutOfScope, isAdminRequest } from "@/lib/scope";

// Wipes a project's schedule data back to "never imported" and re-arms the
// setup wizard. The project row itself survives, so the binding to the Skiles
// Connect project (osProjectId) and the trade partner cache are kept — this is
// "start the schedule over", not "delete the project".
//
// Deliberately does NOT touch the global dictionaries (ScopeDictionaryEntry,
// ScopeSplitRule, TradeDictionaryEntry): they are shared by every project, and
// wiping them from one project's page would silently reset the others. Bad
// entries are removed one at a time from the Task Naming and Task Granularity
// pages.
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = await denyIfOutOfScope(req, params.id);
  if (denied) return denied;
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: { message: "Admin access required." } }, { status: 403 });
  }

  const projectId = params.id;
  await prisma.$transaction([
    // Imports cascade to activities, relationships, resources, assignments,
    // calendars, progress updates and accepted splits.
    prisma.scheduleImport.deleteMany({ where: { projectId } }),
    prisma.completenessDismissal.deleteMany({ where: { projectId } }),
    prisma.tradeScopeDismissal.deleteMany({ where: { projectId } }),
    prisma.projectTradeAssignment.deleteMany({ where: { projectId } }),
    prisma.project.update({ where: { id: projectId }, data: { onboardingCompletedAt: null } }),
  ]);

  return NextResponse.redirect(appUrl(req, `/projects/${projectId}/import`), { status: 303 });
}
