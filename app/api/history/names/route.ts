import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/http";
import { isAdminRequest } from "@/lib/scope";
import { confirmMapping } from "@/lib/normalize/normalizationService";
import { normalizeName } from "@/lib/normalize/normalizeName";

// The cross-project name review: map a name to a standard scope (an existing one
// or a new one — typing it is the approval) or ignore it. Both are global.
export async function POST(req: Request) {
  if (!(await isAdminRequest(req))) return error("Admin access required.", 403);
  const form = await req.formData();
  const name = String(form.get("name") ?? "");
  const normalizedName = normalizeName(name);
  if (!normalizedName) return error("name is required.", 422);

  if (form.get("ignore")) {
    await prisma.scopeIgnoredName.upsert({ where: { normalizedName }, create: { normalizedName }, update: {} });
  } else {
    const scope = String(form.get("scope") ?? "").trim();
    if (!scope) return error("Pick or type a standard scope.", 422);
    await confirmMapping(name, scope);
  }
  const min = String(form.get("min") ?? "");
  return NextResponse.redirect(appUrl(req, `/history/names${/^\d+$/.test(min) ? `?min=${min}` : ""}`), { status: 303 });
}

function error(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}
