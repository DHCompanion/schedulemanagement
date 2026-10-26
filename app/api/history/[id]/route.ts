import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/http";
import { isAdminRequest } from "@/lib/scope";
import { SUBTYPES, TIER_OVERRIDES, parseDetails, parseSubType } from "@/lib/historical";

// Admin edits on a historical project: its details (project type, which sets the sector; subtype; size;
// whether it feeds benchmarks) or one import's tier override. The only writes the library allows. Cross-project
// on purpose, so there is no scope check — an OS-launched tool admin may edit any.
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!(await isAdminRequest(req))) return error("Admin access required.", 403);
  const project = await prisma.project.findUnique({ where: { id }, select: { status: true, buildingType: true, subType: true } });
  if (project?.status !== "historical") return error("Historical project not found.", 404);

  const form = await req.formData();
  const field = (name: string) => String(form.get(name) ?? "").trim();
  const back = NextResponse.redirect(appUrl(req, `/history/${id}`), { status: 303 });

  const importId = field("importId");
  if (importId) {
    const tier = field("tierOverride");
    if (tier && !(TIER_OVERRIDES as readonly string[]).includes(tier)) return error("Tier override must be rough or junk.", 422);
    const { count } = await prisma.scheduleImport.updateMany({ where: { id: importId, projectId: id }, data: { tierOverride: tier || null } });
    if (!count) return error("Import not found.", 404);
    // Counts toward "edited since last compute" on /history.
    await prisma.project.update({ where: { id }, data: { updatedAt: new Date() } });
    return back;
  }

  // Only the fields sent change: the list edits one at a time.
  const use = form.get("useInBenchmarks");
  if (use !== null && use !== "true" && use !== "false") return error("useInBenchmarks must be true or false.", 422);
  try {
    const d = parseDetails({ sector: field("sector"), buildingType: field("buildingType"), sizeSqFt: field("sizeSqFt") });
    const typeSent = form.has("buildingType") || form.has("sector");
    const type = typeSent ? d.buildingType : project.buildingType;
    // A type change keeps the subtype only if the new type has it too.
    const subType = form.has("subType") ? parseSubType(type, field("subType")) : SUBTYPES[type ?? ""]?.includes(project.subType ?? "") ? project.subType : null;
    const data = {
      ...(typeSent && { sector: d.sector, buildingType: d.buildingType }),
      ...((typeSent || form.has("subType")) && { subType }),
      ...(form.has("sizeSqFt") && { sizeSqFt: d.sizeSqFt }),
      ...(use !== null && { useInBenchmarks: use === "true" }),
    };
    await prisma.project.update({ where: { id }, data });
  } catch (e) {
    return error(e instanceof Error ? e.message : "Invalid details.", 422);
  }
  return back;
}

function error(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}
