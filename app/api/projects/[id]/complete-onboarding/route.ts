import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requestBaseUrl } from "@/lib/http";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await prisma.project.update({ where: { id: params.id }, data: { onboardingCompletedAt: new Date() } });
  const base = requestBaseUrl(req);
  return NextResponse.redirect(new URL(`/projects/${params.id}`, base), { status: 303 });
}
