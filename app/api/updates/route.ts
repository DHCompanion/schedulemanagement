import { NextResponse } from "next/server";
import { getOrCreateDraft } from "@/lib/updates/updateService";
import { requestBaseUrl } from "@/lib/http";

export async function POST(req: Request) {
  const base = requestBaseUrl(req);
  const form = await req.formData();
  const projectId = String(form.get("projectId") ?? "");
  const asOfDate = String(form.get("asOfDate") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const n = Number(form.get("lookaheadWeeks") ?? 3);
  const weeks = [1, 3, 6].includes(n) ? n : 3;
  if (!projectId) return NextResponse.redirect(new URL("/", base), { status: 303 });
  try {
    const { id } = await getOrCreateDraft(projectId, asOfDate, weeks);
    return NextResponse.redirect(new URL(`/projects/${projectId}/updates/${id}`, base), { status: 303 });
  } catch {
    return NextResponse.redirect(new URL(`/projects/${projectId}/updates?error=1`, base), { status: 303 });
  }
}
