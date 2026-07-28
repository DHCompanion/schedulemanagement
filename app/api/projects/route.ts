import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/http";
import { scopeFromRequest } from "@/lib/scope";

export async function GET(req: Request) {
  // A scoped session sees only its own project, never the catalogue.
  const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
  const projects = await prisma.project.findMany({
    where: scope ? { id: scope.projectId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  // Projects are created by the OS launch handoff, not by hand, inside a scoped
  // session — the local project is bound to an OS project id it cannot invent.
  const scope = await scopeFromRequest(req, Math.floor(Date.now() / 1000));
  if (scope) {
    return NextResponse.json(
      { error: { message: "Projects come from Skiles Connect in a launched session." } },
      { status: 403 }
    );
  }

  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return NextResponse.redirect(appUrl(req, "/projects/new?error=1"), { status: 303 });

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
  return NextResponse.redirect(appUrl(req, `/projects/${project.id}`), { status: 303 });
}
