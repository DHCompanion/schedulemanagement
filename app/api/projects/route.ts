import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const projects = await prisma.project.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return NextResponse.redirect(new URL("/projects/new?error=1", req.url), { status: 303 });

  const sizeSqFtRaw = String(form.get("sizeSqFt") ?? "").trim();
  const contractValueRaw = String(form.get("contractValue") ?? "").trim();

  const project = await prisma.project.create({
    data: {
      name,
      client: String(form.get("client") ?? "").trim() || null,
      sector: String(form.get("sector") ?? "").trim() || null,
      buildingType: String(form.get("buildingType") ?? "").trim() || null,
      sizeSqFt: sizeSqFtRaw ? Number(sizeSqFtRaw) : null,
      contractValue: contractValueRaw ? contractValueRaw : null,
      region: String(form.get("region") ?? "").trim() || null,
      deliveryMethod: String(form.get("deliveryMethod") ?? "").trim() || null,
    },
  });
  return NextResponse.redirect(new URL(`/projects/${project.id}`, req.url), { status: 303 });
}
