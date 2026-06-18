import { NextResponse } from "next/server";
import { buildExport } from "@/lib/export/buildExport";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  if (!(file instanceof File) || !projectId) {
    return NextResponse.json({ error: { message: "file and projectId are required." } }, { status: 400 });
  }
  const xml = await file.text();
  try {
    const out = await buildExport(projectId, xml, file.name);
    return new Response(out.xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml",
        "Content-Disposition": `attachment; filename="${out.fileName}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Export failed.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
