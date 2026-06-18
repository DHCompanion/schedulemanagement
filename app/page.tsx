import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { imports: true } } },
  });

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Link href="/projects/new" className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">
          New Project
        </Link>
      </div>
      {projects.length === 0 ? (
        <p className="text-slate-500">No projects yet. Create one to import a schedule.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-slate-500">{p._count.imports} import(s)</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
