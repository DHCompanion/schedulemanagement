import { NextResponse } from "next/server";
import { confirmDiscipline, assignTradePartner } from "@/lib/trades/tradesService";
import { denyOutOfScope, scopeFromRequest } from "@/lib/scope";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    projectId?: string;
    disciplines?: { canonicalScope: string; osDisciplineId: number; disciplineName: string }[];
    assignments?: { osDisciplineId: number; osPartnerId: number }[];
  };
  if (!body.projectId) {
    return NextResponse.json({ error: { message: "projectId required." } }, { status: 422 });
  }

  const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
  const denied = denyOutOfScope(scope, body.projectId);
  if (denied) return denied;

  try {
    for (const entry of body.disciplines ?? []) {
      if (entry?.canonicalScope && Number.isInteger(entry.osDisciplineId) && entry.disciplineName) {
        await confirmDiscipline(entry.canonicalScope, entry.osDisciplineId, entry.disciplineName, scope?.personId);
      }
    }
    // assignTradePartner rejects any partner that is not on this project's
    // cached roster, so an invented osPartnerId is a no-op rather than a write.
    for (const entry of body.assignments ?? []) {
      if (Number.isInteger(entry?.osDisciplineId) && Number.isInteger(entry?.osPartnerId)) {
        await assignTradePartner(body.projectId, entry.osDisciplineId, entry.osPartnerId, scope?.personId);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
