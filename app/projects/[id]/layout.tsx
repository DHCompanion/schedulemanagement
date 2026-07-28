import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { osAppOrigins } from "@/lib/http";
import { SCOPE_COOKIE, readScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

// A persistent project banner across every page of a project, matching the
// header Procurement Management uses so the two tools read as one system:
// project name on the left, who you are and the way out on the right.
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { id: string };
}) {
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { name: true, client: true },
  });
  if (!project) notFound();

  const scope = await readScope(cookies().get(SCOPE_COOKIE)?.value, Math.floor(Date.now() / 1000));
  const person = scope?.personName ?? scope?.accessRole ?? null;
  // Launched from Connect: the way out is back to the Tools page, not this
  // tool's project list — which a scoped session cannot see anyway.
  const connectHref = scope ? `${osAppOrigins()[0] ?? ""}/tools` : null;

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-baseline gap-3">
            <Link href={`/projects/${params.id}`} className="truncate font-semibold text-slate-900">
              {project.name}
            </Link>
            {project.client && <span className="truncate text-sm text-slate-500">{project.client}</span>}
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            {person && <span className="truncate">{person}</span>}
            {connectHref ? (
              <a href={connectHref} className="whitespace-nowrap underline hover:text-slate-900">
                Back to Connect
              </a>
            ) : (
              <Link href="/" className="whitespace-nowrap underline hover:text-slate-900">
                Projects
              </Link>
            )}
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
