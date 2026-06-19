import { NextResponse } from "next/server";
import { confirmDiscipline, assignTradePartner } from "@/lib/trades/tradesService";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    projectId?: string;
    disciplines?: { canonicalScope: string; discipline: string }[];
    assignments?: { discipline: string; companyName: string }[];
  };
  if (!body.projectId) {
    return NextResponse.json({ error: { message: "projectId required." } }, { status: 422 });
  }
  try {
    for (const d of body.disciplines ?? []) {
      if (d?.canonicalScope && d?.discipline) await confirmDiscipline(d.canonicalScope, d.discipline);
    }
    for (const a of body.assignments ?? []) {
      if (a?.discipline && a?.companyName) await assignTradePartner(body.projectId, a.discipline, a.companyName);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save.";
    return NextResponse.json({ error: { message } }, { status: 422 });
  }
}
