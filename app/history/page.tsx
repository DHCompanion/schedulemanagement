import Link from "next/link";
import { prisma } from "@/lib/db";
import { PROJECT_TYPES, SECTORS, fiscalYear } from "@/lib/historical";
import { appPath } from "@/lib/http";
import { isAdminSession } from "@/lib/adminSession";
import { getBenchmarkStatus } from "@/lib/benchmarks/benchmarkService";
import { getImportQuality } from "@/lib/health/healthService";
import { workingDaysBetween } from "@/lib/forecast/workingDays";
import { HistoryTable, type HistoryGroup, type HistoryImport, type HistoryRow } from "@/components/HistoryTable";

export const dynamic = "force-dynamic";

type Query = { q?: string; fy?: string; type?: string; bench?: string; group?: string; sort?: string; dir?: string; open?: string };

const date = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const SORTS: Record<string, (r: HistoryRow) => string | number> = {
  name: (r) => r.name.toLowerCase(),
  fy: (r) => r.fy ?? 0,
  type: (r) => r.buildingType ?? "",
  schedules: (r) => r.schedules,
  start: (r) => r.start ?? "",
  days: (r) => r.workDays ?? -1,
  activities: (r) => r.activities,
};

// The historical library (plan Q51): backfilled projects, read-only apart from
// admin true-up edits, kept out of the live project list. Middleware lets in
// standalone sessions and OS tool admins.
export default async function HistoryPage(props: { searchParams: Promise<Query> }) {
  const query = await props.searchParams;
  const [admin, benchmarks, projects] = await Promise.all([
    isAdminSession(),
    getBenchmarkStatus(),
    prisma.project.findMany({
      where: { status: "historical" },
      select: {
        id: true, name: true, externalProjectKey: true, sector: true, buildingType: true, sizeSqFt: true, useInBenchmarks: true, updatedAt: true,
        imports: { orderBy: { importedAt: "asc" }, select: { fileName: true, projectStart: true, projectFinish: true, activityCount: true } },
      },
    }),
  ]);

  const all: HistoryRow[] = projects.map((p) => {
    const latest = p.imports.at(-1);
    return {
      id: p.id, name: p.name, fy: fiscalYear(p.externalProjectKey), buildingType: p.buildingType, sizeSqFt: p.sizeSqFt,
      useInBenchmarks: p.useInBenchmarks, schedules: p.imports.length,
      start: date(latest?.projectStart ?? null), finish: date(latest?.projectFinish ?? null),
      workDays: latest?.projectStart && latest.projectFinish ? workingDaysBetween(latest.projectStart, latest.projectFinish) : null,
      activities: latest?.activityCount ?? 0,
    };
  });
  const edited = benchmarks.computedAt ? projects.filter((p) => p.updatedAt > benchmarks.computedAt!).length : 0;
  const years = [...new Set(all.map((r) => r.fy).filter((y) => y !== null))].sort();

  const q = query.q?.trim().toLowerCase();
  const files = new Map(projects.map((p) => [p.id, p.imports.map((i) => i.fileName.toLowerCase())]));
  const rows = all.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || files.get(r.id)!.some((f) => f.includes(q))) &&
    (!query.fy || String(r.fy) === query.fy) &&
    (!query.type || (query.type === "none" ? !r.buildingType : r.buildingType === query.type)) &&
    (!query.bench || r.useInBenchmarks === (query.bench === "in")),
  );
  const sort = SORTS[query.sort ?? ""] ? query.sort! : "name";
  const dir = query.dir === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    const x = SORTS[sort](a), y = SORTS[sort](b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.name.localeCompare(b.name);
  });
  const group = query.group === "type" || query.group === "none" ? query.group : "fy";
  const groups = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const label = group === "none" ? "" : group === "type" ? (r.buildingType ?? "No project type") : r.fy ? `FY${r.fy}` : "No fiscal year";
    groups.set(label, [...(groups.get(label) ?? []), r]);
  }
  const grouped: HistoryGroup[] = [...groups].map(([label, rows]) => ({ label, rows }));
  if (group !== "none") grouped.sort((a, b) => (group === "fy" ? b.label.localeCompare(a.label) : a.label.localeCompare(b.label)));

  // Tiers need every activity, so only the open project's are worked out.
  const openId = rows.some((r) => r.id === query.open) ? query.open! : null;
  const openImports: HistoryImport[] = openId
    ? await Promise.all(
        (await prisma.scheduleImport.findMany({ where: { projectId: openId }, orderBy: { importedAt: "asc" } })).map(async (i) => {
          const quality = await getImportQuality(i.id);
          return {
            id: i.id, fileName: i.fileName, isBaseline: i.isBaseline, statusDate: date(i.statusDate), start: date(i.projectStart), finish: date(i.projectFinish),
            activities: i.activityCount, tierOverride: i.tierOverride, tier: quality.tier, reasons: quality.reasons,
            logic: `${quality.logic.passed} of ${quality.logic.total}`,
          };
        }),
      )
    : [];

  const select = "h-9 rounded border border-slate-300 bg-white px-2 text-sm";
  const types = SECTORS.map((s) => ({ sector: s, types: [...PROJECT_TYPES[s]] }));

  return (
    <main className="mx-auto max-w-[1680px] p-4 sm:px-8 sm:py-5">
      <Link href="/" className="text-sm text-slate-500">← Projects</Link>
      <div className="mb-3 mt-1 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Historical schedules</h1>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {admin && (
            <form action={appPath("/api/history/benchmarks")} method="post" className="flex flex-wrap items-center gap-3">
              <span className="text-slate-600">
                Benchmarks: {benchmarks.computedAt ? `${benchmarks.rows.toLocaleString()} ranges, computed ${benchmarks.computedAt.toLocaleString("en-US", { timeZone: "America/Chicago" })}` : "never computed"}
                {edited > 0 && <b className="ml-2 font-medium text-amber-700">· {edited} project{edited === 1 ? "" : "s"} edited since</b>}
              </span>
              <button className="h-9 rounded border border-slate-300 bg-white px-3 font-medium hover:bg-slate-50">Recompute</button>
            </form>
          )}
          {admin && <Link href="/history/draft-baseline" className="text-slate-600 underline hover:text-slate-900">Draft baseline</Link>}
          <Link href="/history/names" className="text-slate-600 underline hover:text-slate-900">Name review</Link>
        </div>
      </div>

      <form className="mb-3 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
        <input type="search" name="q" defaultValue={query.q ?? ""} placeholder="Search project or file name" aria-label="Search" className={`${select} w-full sm:w-72`} />
        <select name="fy" defaultValue={query.fy ?? ""} aria-label="Fiscal year" className={select}>
          <option value="">All years</option>
          {years.map((y) => <option key={y} value={y}>FY{y}</option>)}
        </select>
        <select name="type" defaultValue={query.type ?? ""} aria-label="Project type" className={select}>
          <option value="">All project types</option>
          <option value="none">No project type</option>
          {types.map(({ sector, types }) => (
            <optgroup key={sector} label={sector}>{types.map((t) => <option key={t}>{t}</option>)}</optgroup>
          ))}
        </select>
        <select name="bench" defaultValue={query.bench ?? ""} aria-label="Benchmarks" className={select}>
          <option value="">In or out of benchmarks</option>
          <option value="in">In benchmarks</option>
          <option value="out">Left out</option>
        </select>
        <select name="group" defaultValue={group} aria-label="Group by" className={select}>
          <option value="fy">Group: fiscal year</option>
          <option value="type">Group: project type</option>
          <option value="none">No grouping</option>
        </select>
        {query.sort && <input type="hidden" name="sort" value={query.sort} />}
        {query.dir && <input type="hidden" name="dir" value={query.dir} />}
        <button className="h-9 rounded bg-slate-900 px-3 text-sm font-medium text-white">Filter</button>
        <span className="ml-auto text-sm text-slate-500">{rows.length} of {all.length} projects · {all.filter((r) => r.useInBenchmarks).length} in benchmarks</span>
      </form>

      {rows.length === 0 ? (
        <p className="text-slate-500">No historical projects match.</p>
      ) : (
        <HistoryTable groups={grouped} admin={admin} types={types} query={query} sort={sort} dir={dir === 1 ? "asc" : "desc"} openId={openId} openImports={openImports} />
      )}
    </main>
  );
}
