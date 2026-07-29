import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assignTradePartner } from "@/lib/trades/tradesService";
import { denyOutOfScope, scopeFromRequest } from "@/lib/scope";

interface DriftBody {
  projectId?: string;
  osDisciplineId?: number;
  fileValue?: string;
  action?: "accept" | "keep";
}

export async function POST(req: Request) {
  const body = (await req.json()) as DriftBody;
  if (
    !body.projectId ||
    !Number.isInteger(body.osDisciplineId) ||
    !body.fileValue?.trim() ||
    (body.action !== "accept" && body.action !== "keep")
  ) {
    return NextResponse.json(
      { error: { message: "projectId, osDisciplineId, fileValue and action are required." } },
      { status: 422 },
    );
  }

  const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
  const denied = denyOutOfScope(scope, body.projectId);
  if (denied) return denied;

  const projectId = body.projectId;
  const osDisciplineId = body.osDisciplineId as number;
  const fileValue = body.fileValue.trim();

  if (body.action === "keep") {
    await prisma.tradeDriftDismissal.upsert({
      where: { projectId_osDisciplineId_fileValue: { projectId, osDisciplineId, fileValue } },
      create: { projectId, osDisciplineId, fileValue, personId: scope?.personId ?? null },
      update: { personId: scope?.personId ?? null },
    });
    return NextResponse.json({ ok: true });
  }

  // Connect owns the roster. A name that matches no partner on this project is
  // reported, never guessed at — inventing an id here would misroute a trade.
  const partner = await prisma.osTradePartner.findFirst({
    where: { projectId, name: fileValue, doNotUse: false },
    select: { osPartnerId: true },
  });
  if (!partner) {
    return NextResponse.json(
      { error: { message: `"${fileValue}" is not a trade partner on this project in Skiles Connect.` } },
      { status: 422 },
    );
  }

  await assignTradePartner(projectId, osDisciplineId, partner.osPartnerId, scope?.personId);
  // The disagreement is settled, so any ruling previously made about this
  // discipline is spent — leaving it would suppress a genuinely new edit.
  await prisma.tradeDriftDismissal.deleteMany({ where: { projectId, osDisciplineId } });
  return NextResponse.json({ ok: true });
}
