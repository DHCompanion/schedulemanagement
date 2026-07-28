import { NextResponse } from "next/server";
import { getOrCreateDraft } from "@/lib/updates/updateService";
import { appUrl } from "@/lib/http";
import { denyOutOfScope, scopeFromRequest } from "@/lib/scope";

export async function POST(req: Request) {
  const form = await req.formData();
  const projectId = String(form.get("projectId") ?? "");
  const asOfDate = String(form.get("asOfDate") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const n = Number(form.get("lookaheadWeeks") ?? 3);
  const weeks = [1, 3, 6].includes(n) ? n : 3;
  if (!projectId) return NextResponse.redirect(appUrl(req, "/"), { status: 303 });

  const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
  const denied = denyOutOfScope(scope, projectId);
  if (denied) return denied;

  try {
    const { id } = await getOrCreateDraft(projectId, asOfDate, weeks, scope?.personId);
    return NextResponse.redirect(appUrl(req, `/projects/${projectId}/updates/${id}`), { status: 303 });
  } catch {
    return NextResponse.redirect(appUrl(req, `/projects/${projectId}/updates?error=1`), { status: 303 });
  }
}
