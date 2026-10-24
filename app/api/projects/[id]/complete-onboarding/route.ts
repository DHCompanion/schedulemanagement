import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/http";
import { denyIfOutOfScope } from "@/lib/scope";
import { denyIfHistorical } from "@/lib/historical";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = (await denyIfOutOfScope(req, params.id)) ?? (await denyIfHistorical(params.id));
  if (denied) return denied;

  await prisma.project.update({ where: { id: params.id }, data: { onboardingCompletedAt: new Date() } });
  return NextResponse.redirect(appUrl(req, `/projects/${params.id}`), { status: 303 });
}
