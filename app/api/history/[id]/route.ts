import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/http";
import { isAdminRequest } from "@/lib/scope";
import { TIER_OVERRIDES, parseDetails } from "@/lib/historical";

// Admin edits on a historical project: its details (sector, building type, size)
// or one import's tier override. The only writes the library allows. Cross-project
// on purpose, so there is no scope check — an OS-launched tool admin may edit any.
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!(await isAdminRequest(req))) return error("Admin access required.", 403);
  const project = await prisma.project.findUnique({ where: { id }, select: { status: true } });
  if (project?.status !== "historical") return error("Historical project not found.", 404);

  const form = await req.formData();
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const back = NextResponse.redirect(appUrl(req, `/history/${id}`), { status: 303 });

  const importId = field("importId");
  if (importId) {
    const tier = field("tierOverride");
    if (tier && !(TIER_OVERRIDES as readonly string[]).includes(tier)) return error("Tier override must be rough or junk.", 422);
    const { count } = await prisma.scheduleImport.updateMany({ where: { id: importId, projectId: id }, data: { tierOverride: tier || null } });
    return count ? back : error("Import not found.", 404);
  }

  try {
    const data = parseDetails({ sector: field("sector"), buildingType: field("buildingType"), sizeSqFt: field("sizeSqFt") });
    await prisma.project.update({ where: { id }, data });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Invalid details.", 422);
  }
  return back;
}

function error(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}
