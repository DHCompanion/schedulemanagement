import { NextResponse } from "next/server";
import { previewImport } from "@/lib/import/commitImport";
import { readUploadedXml } from "@/lib/http";
import { getReimportPreview } from "@/lib/import/reimportPreview";
import { denyIfOutOfScope } from "@/lib/scope";
import { denyIfHistorical } from "@/lib/historical";

// Without a projectId, preview reads nothing from the database — it parses the
// uploaded file and hands back its own contents. With one, it is scope-checked
// like commit and adds a read-only comparison against that project's schedule.
// Writes nothing either way. Authentication still applies (this path is not in
// the middleware's PUBLIC_PATHS). The size cap below is what keeps an
// authenticated caller from turning the parser into a resource-exhaustion lever.
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { message: "No file uploaded." } }, { status: 400 });
  }
  const projectId = String(form.get("projectId") ?? "");
  const denied = projectId ? (await denyIfOutOfScope(req, projectId)) ?? (await denyIfHistorical(projectId)) : null;
  if (denied) return denied;
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
      ...(projectId && { reimport: await getReimportPreview(projectId, parsed.activities) }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to parse file.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
