import { NextResponse } from "next/server";
import { previewImport } from "@/lib/import/commitImport";
import { readUploadedXml } from "@/lib/http";

// No project scope check: preview names no project, reads nothing from the
// database and writes nothing — it parses the uploaded file and hands back its
// own contents. Authentication still applies (this path is not in the
// middleware's PUBLIC_PATHS). The size cap below is what keeps an authenticated
// caller from turning the parser into a resource-exhaustion lever.
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { message: "No file uploaded." } }, { status: 400 });
  }
  const upload = await readUploadedXml(file);
  if ("error" in upload) {
    return NextResponse.json({ error: { message: upload.error } }, { status: 413 });
  }
  const { xml } = upload;
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
