import { NextResponse } from "next/server";
import { confirmMapping } from "@/lib/normalize/normalizationService";

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
