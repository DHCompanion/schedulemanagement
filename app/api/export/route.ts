import { NextResponse } from "next/server";
import { readUploadedXml } from "@/lib/http";
import { buildExport } from "@/lib/export/buildExport";
import { denyIfOutOfScope } from "@/lib/scope";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  if (!(file instanceof File) || !projectId) {
    return NextResponse.json({ error: { message: "file and projectId are required." } }, { status: 400 });
  }

  const denied = await denyIfOutOfScope(req, projectId);
  if (denied) return denied;
  const upload = await readUploadedXml(file);
  if ("error" in upload) {
    return NextResponse.json({ error: { message: upload.error } }, { status: 413 });
  }
  const { xml } = upload;
  try {
    const out = await buildExport(projectId, xml, file.name);
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
