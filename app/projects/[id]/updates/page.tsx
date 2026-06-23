import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function UpdatesPage({ params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id } });
  if (!project) notFound();

  const latest = await prisma.scheduleImport.findFirst({ where: { projectId: project.id }, orderBy: { importedAt: "desc" } });
  const updates = await prisma.progressUpdate.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { entries: true } } },
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href={`/projects/${project.id}`} className="text-sm text-slate-500">← {project.name}</Link>
      <h1 className="mb-4 mt-1 text-xl font-semibold">Progress Update</h1>

      {!latest ? (
        <p className="text-slate-500">Import a schedule before starting weekly updates.</p>
      ) : (
        <form action="/api/updates" method="post" className="mb-6 flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-3">
          <input type="hidden" name="projectId" value={project.id} />
          <label className="text-sm">As-of date
            <input type="date" name="asOfDate" defaultValue={today} className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <label className="text-sm">Lookahead
            <select name="lookaheadWeeks" defaultValue="1" className="mt-1 block rounded border border-slate-300 px-2 py-1 text-sm">
              <option value="1">1 week</option>
              <option value="3">3 weeks</option>
              <option value="6">6 weeks</option>
            </select>
          </label>
          <button className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">New update</button>
        </form>
      )}

      {updates.length === 0 ? (
        <p className="text-slate-500">No updates yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {updates.map((u) => (
            <li key={u.id}>
              <Link href={`/projects/${project.id}/updates/${u.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <span className="font-medium">{u.asOfDate.toISOString().slice(0, 10)} · {u.lookaheadWeeks}wk</span>
                <span className="text-sm text-slate-500">{u.state} · {u._count.entries} entries</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
