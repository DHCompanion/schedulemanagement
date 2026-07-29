import { NextResponse } from "next/server";
import { confirmMapping, removeMapping } from "@/lib/normalize/normalizationService";
import { isAdminRequest } from "@/lib/scope";

export async function POST(req: Request) {
  const body = (await req.json()) as { mappings?: { rawName: string; canonicalScope: string }[] };
  if (!Array.isArray(body.mappings)) {
    return NextResponse.json({ error: { message: "mappings array required." } }, { status: 422 });
  }
  try {
    for (const m of body.mappings) {
      if (m?.rawName && m?.canonicalScope) await confirmMapping(m.rawName, m.canonicalScope);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}

// Admin-only: the dictionary is shared by every project, so unmapping a name
// affects all of them.
export async function DELETE(req: Request) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: { message: "Admin access required." } }, { status: 403 });
  }
  const body = (await req.json()) as { rawName?: string };
  if (!body.rawName?.trim()) {
    return NextResponse.json({ error: { message: "rawName is required." } }, { status: 422 });
  }
  try {
    await removeMapping(body.rawName);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to remove.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
