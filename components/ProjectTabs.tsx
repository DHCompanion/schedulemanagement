import Link from "next/link";

// The two-workspace shell (spec §2): Schedule is the weekly rhythm, Data
// Health is the post-import hygiene burst; the badge is that burst's loudness.
export function ProjectTabs({ projectId, active, dataBadge }: { projectId: string; active: "schedule" | "data"; dataBadge: number }) {
  const base = "border-b-2 px-4 py-2 text-sm font-medium";
  const on = "border-cyan-700 text-cyan-800";
  const off = "border-transparent text-slate-500 hover:text-slate-800";
  return (
    <nav className="mb-4 flex border-b border-slate-200">
      <Link href={`/projects/${projectId}`} className={`${base} ${active === "schedule" ? on : off}`}>
        Schedule
      </Link>
      <Link href={`/projects/${projectId}/data`} className={`${base} ${active === "data" ? on : off}`}>
        Data Health
        {dataBadge > 0 && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{dataBadge}</span>
        )}
      </Link>
    </nav>
  );
}
