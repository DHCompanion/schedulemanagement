import { NextResponse } from "next/server";
import { readUploadedXml } from "@/lib/http";
import { buildExport, type ExportUpload } from "@/lib/export/buildExport";
import { denyIfOutOfScope } from "@/lib/scope";
import { denyIfHistorical } from "@/lib/historical";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  if (!projectId) {
    return NextResponse.json({ error: { message: "projectId is required." } }, { status: 400 });
  }

  const denied = (await denyIfOutOfScope(req, projectId)) ?? (await denyIfHistorical(projectId));
  if (denied) return denied;
  // No file means export from the stored original.
  let exportUpload: ExportUpload = null;
  if (file instanceof File) {
    const upload = await readUploadedXml(file);
    if ("error" in upload) {
      return NextResponse.json({ error: { message: upload.error } }, { status: 413 });
    }
    exportUpload = { xml: upload.xml, fileName: file.name };
  }
  try {
    const out = await buildExport(projectId, exportUpload);
    return new Response(out.xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml",
        "Content-Disposition": `attachment; filename="${out.fileName}"`,
        "X-Deleted-Tasks": JSON.stringify(out.deletedTasks),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Export failed.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
