import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/http";
import { denyIfOutOfScope } from "@/lib/scope";

// Sets the project's data date by hand from the schedule screen. An empty value
// clears it, handing the data date back to the latest import or progress update.
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = await denyIfOutOfScope(req, params.id);
  if (denied) return denied;

  const raw = String((await req.formData()).get("dataDate") ?? "").trim();
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return NextResponse.json({ error: { message: "dataDate must be YYYY-MM-DD." } }, { status: 422 });
  }
  // 17:00 wall-clock stored as UTC — the same end-of-day convention an MS
  // Project status date arrives with on import.
  const dataDate = raw ? new Date(`${raw}T17:00:00Z`) : null;
  if (dataDate && Number.isNaN(dataDate.getTime())) {
    return NextResponse.json({ error: { message: "dataDate is not a real date." } }, { status: 422 });
  }

  await prisma.project.update({
    where: { id: params.id },
    data: { dataDateOverride: dataDate, dataDateOverrideAt: dataDate ? new Date() : null },
  });
  return NextResponse.redirect(appUrl(req, `/projects/${params.id}`), { status: 303 });
}
