import Link from "next/link";

// The two-workspace shell (spec §2): Schedule is the weekly rhythm, Data
// Health is the post-import hygiene burst; the badge is that burst's loudness.
// Admin is a third tab only admins are shown: the shared dictionaries and the
// reset, kept out of the everyday review flow.
export function ProjectTabs({
  projectId,
  active,
  dataBadge,
  isAdmin = false,
}: {
  projectId: string;
  active: "schedule" | "data" | "admin";
  dataBadge: number;
  isAdmin?: boolean;
}) {
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
      {isAdmin && (
        <Link href={`/projects/${projectId}/admin`} className={`${base} ${active === "admin" ? on : off}`}>
          Admin
        </Link>
      )}
    </nav>
  );
}
