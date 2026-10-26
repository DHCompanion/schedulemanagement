import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PROJECT_TYPES, SECTORS, fiscalYear } from "@/lib/historical";
import { appPath } from "@/lib/http";
import { isAdminSession } from "@/lib/adminSession";
import { getBenchmarkStatus } from "@/lib/benchmarks/benchmarkService";

export const dynamic = "force-dynamic";

// The historical library (plan Q51): backfilled projects, read-only, kept out of
// the live project list. Middleware lets in standalone sessions and OS tool admins.
export default async function HistoryPage(props: { searchParams: Promise<{ fy?: string; sector?: string; buildingType?: string }> }) {
  const { fy, sector, buildingType } = await props.searchParams;
  const where: Prisma.ProjectWhereInput = { status: "historical" };
  if (fy) where.externalProjectKey = { startsWith: `backfill:FY${fy}:` };
  if (sector) where.sector = sector;
  if (buildingType) where.buildingType = buildingType;
  const [admin, benchmarks] = await Promise.all([isAdminSession(), getBenchmarkStatus()]);
  const [projects, keys] = await Promise.all([
    prisma.project.findMany({ where, orderBy: { name: "asc" }, include: { _count: { select: { imports: true } } } }),
    prisma.project.findMany({ where: { status: "historical" }, select: { externalProjectKey: true } }),
  ]);
  const years = [...new Set(keys.map((k) => fiscalYear(k.externalProjectKey)).filter((y) => y !== null))].sort();
  const byYear = new Map<number | null, typeof projects>();
  for (const p of projects) {
    const y = fiscalYear(p.externalProjectKey);
    byYear.set(y, [...(byYear.get(y) ?? []), p]);
  }
  const select = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <Link href="/" className="text-sm text-slate-500">← Projects</Link>
      <div className="mb-4 mt-1 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Historical schedules</h1>
        <div className="flex gap-4">
          {admin && <Link href="/history/draft-baseline" className="text-sm text-slate-600 underline hover:text-slate-900">Draft baseline</Link>}
          <Link href="/history/names" className="text-sm text-slate-600 underline hover:text-slate-900">Name review</Link>
        </div>
      </div>
      {admin && (
        <form action={appPath("/api/history/benchmarks")} method="post" className="mb-4 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-sm">
          <span className="text-slate-600">
            Duration benchmarks: {benchmarks.computedAt ? `${benchmarks.rows} ranges, last computed ${benchmarks.computedAt.toLocaleString("en-US", { timeZone: "America/Chicago" })}` : "never computed"}
          </span>
          <button className="rounded border border-slate-300 px-3 py-1 font-medium hover:bg-slate-50">Recompute benchmarks</button>
        </form>
      )}
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <select name="fy" defaultValue={fy ?? ""} aria-label="Fiscal year" className={select}>
          <option value="">All years</option>
          {years.map((y) => <option key={y} value={y}>FY{y}</option>)}
        </select>
        <select name="sector" defaultValue={sector ?? ""} aria-label="Sector" className={select}>
          <option value="">All sectors</option>
          {SECTORS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select name="buildingType" defaultValue={buildingType ?? ""} aria-label="Project type" className={select}>
          <option value="">All project types</option>
          {SECTORS.map((s) => (
            <optgroup key={s} label={s}>
              {PROJECT_TYPES[s].map((t) => <option key={t}>{t}</option>)}
            </optgroup>
          ))}
        </select>
        <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Filter</button>
      </form>
      {projects.length === 0 && <p className="text-slate-500">No historical projects match.</p>}
      {[...byYear].sort(([a], [b]) => (b ?? 0) - (a ?? 0)).map(([year, list]) => (
        <section key={year ?? "none"} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-600">{year ? `FY${year}` : "No fiscal year"} · {list.length}</h2>
          <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
            {list.map((p) => (
              <li key={p.id}>
                <Link href={`/history/${p.id}`} className="flex flex-wrap items-center justify-between gap-x-4 px-4 py-3 hover:bg-slate-50">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-sm text-slate-500">
                    {[p.buildingType, `${p._count.imports} schedule(s)`].filter(Boolean).join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
