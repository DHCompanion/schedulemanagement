import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { appPath } from "@/lib/http";
import { isAdminSession } from "@/lib/adminSession";
import { getImportQuality } from "@/lib/health/healthService";
import { PROJECT_TYPES, SECTORS, TIER_OVERRIDES, fiscalYear } from "@/lib/historical";
import { TierBadge } from "@/components/TierBadge";

export const dynamic = "force-dynamic";

const date = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "—";

// One historical project, read-only. Admins may set its details and demote an
// import's tier; nothing else about it can change (plan Q51).
export default async function HistoricalProjectPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { imports: { orderBy: { importedAt: "asc" }, select: { id: true, fileName: true, isBaseline: true, statusDate: true, projectStart: true, projectFinish: true, activityCount: true, tierOverride: true } } },
  });
  if (project?.status !== "historical") notFound();
  const admin = await isAdminSession();
  const imports = await Promise.all(project.imports.map(async (i) => ({ ...i, quality: await getImportQuality(i.id) })));
  const fy = fiscalYear(project.externalProjectKey);
  const action = appPath(`/api/history/${project.id}`);
  const input = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <Link href="/history" className="text-sm text-slate-500">← Historical schedules</Link>
      <h1 className="mt-1 text-xl font-semibold">{project.name}</h1>
      <p className="mb-4 text-sm text-slate-500">{fy ? `FY${fy} · ` : ""}Read-only historical project</p>

      {admin ? (
        <form action={action} method="post" className="mb-6 flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-3">
          <label className="flex flex-col text-xs text-slate-600">Project type
            <select name="buildingType" defaultValue={project.buildingType ?? ""} className={input}>
              <option value="">—</option>
              {SECTORS.map((s) => (
                <optgroup key={s} label={s}>
                  {PROJECT_TYPES[s].map((t) => <option key={t}>{t}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-600">Size (sq ft)
            <input name="sizeSqFt" inputMode="numeric" defaultValue={project.sizeSqFt ?? ""} className={`${input} w-28`} />
          </label>
          <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Save</button>
          {project.sector && <span className="text-xs text-slate-500">Sector: {project.sector}</span>}
        </form>
      ) : (
        <p className="mb-6 text-sm text-slate-700">
          {[project.projectNumber && `#${project.projectNumber}`, project.sector, project.buildingType, project.subType, project.sizeSqFt && `${project.sizeSqFt.toLocaleString()} sf`].filter(Boolean).join(" · ") || "No details yet."}
        </p>
      )}

      <h2 className="mb-2 text-sm font-semibold text-slate-600">Schedules · {imports.length}</h2>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {imports.map((i) => (
          <li key={i.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-words font-medium">
                {i.fileName}
                {i.isBaseline && <span className="ml-2 text-xs text-slate-500">baseline</span>}
              </span>
              <TierBadge tier={i.quality.tier} />
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Status {date(i.statusDate)} · {date(i.projectStart)} → {date(i.projectFinish)} · {i.activityCount} activities · {i.quality.logic.passed} of {i.quality.logic.total} logic checks pass
            </div>
            {i.quality.reasons.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                {i.quality.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
            {admin && (
              <form action={action} method="post" className="mt-2 flex items-center gap-2 text-xs">
                <input type="hidden" name="importId" value={i.id} />
                <label className="text-slate-600">Tier override
                  <select name="tierOverride" defaultValue={i.tierOverride ?? ""} className={`${input} ml-2 py-1 text-xs`}>
                    <option value="">Automatic</option>
                    {TIER_OVERRIDES.map((t) => <option key={t} value={t}>{t === "junk" ? "Too small" : "Rough"}</option>)}
                  </select>
                </label>
                <button className="rounded border border-slate-300 px-2 py-1 font-medium">Set</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
