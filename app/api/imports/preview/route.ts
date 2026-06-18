import { NextResponse } from "next/server";
import { previewImport } from "@/lib/import/commitImport";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { message: "No file uploaded." } }, { status: 400 });
  }
  const xml = await file.text();
  try {
    const { parsed, suggestedIsBaseline } = previewImport(xml);
    return NextResponse.json({
      title: parsed.header.titleFromFile,
      statusDate: parsed.header.statusDate,
      suggestedIsBaseline,
      counts: parsed.counts,
      fieldDefinitions: parsed.fieldDefinitions,
      warnings: parsed.warnings,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to parse file.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
