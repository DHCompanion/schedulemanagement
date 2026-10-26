import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/scope";
import { buildDraft, getDraftGroup, readDraftQuery } from "@/lib/baseline/draftInputs";
import { draftToMspdi } from "@/lib/baseline/draftMspdi";

// Downloads the draft baseline the /history/draft-baseline page previews, as MS Project XML. Admin only (v1).
export async function GET(req: Request) {
  if (!(await isAdminRequest(req))) return error("Admin access required.", 403);
  const { type, subType, start, scopes } = readDraftQuery(new URL(req.url).searchParams);
  if (!start || scopes.length === 0) return error("Choose a start date and at least one standard name.", 422);
  const group = await getDraftGroup(type, subType);
  if ("error" in group) return error(group.error, 422);
  const title = `Draft baseline - ${type}${group.subType ? ` - ${group.subType}` : ""}`;
  const xml = draftToMspdi(await buildDraft(group, scopes, start), title);
  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `attachment; filename="${title.replace(/[^\w .()-]/g, "_")}.xml"` },
  });
}

function error(message: string, status: number) {
  return NextResponse.json({ error: { message } }, { status });
}
