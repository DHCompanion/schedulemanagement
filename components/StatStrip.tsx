import Link from "next/link";

export interface StatStripProps {
  projectId: string;
  driftDays: number;
  atRiskCount: number;
  percentComplete: number;
  lastUpdate: { daysAgo: number } | null;
}

// Every stat links into the body: drift sorts by slip, at-risk filters to flagged.
export function StatStrip({ projectId, driftDays, atRiskCount, percentComplete, lastUpdate }: StatStripProps) {
  const stale = lastUpdate !== null && lastUpdate.daysAgo > 7;
  const box = "rounded border p-3 text-center";
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Link href={`/projects/${projectId}?sort=drift`} className={`${box} border-slate-200 bg-white hover:bg-slate-50`}>
        <div className={`text-xl font-bold ${driftDays > 0 ? "text-red-600" : "text-slate-900"}`}>
          {driftDays > 0 ? `+${driftDays}d` : "on plan"}
        </div>
        <div className="text-xs text-slate-500">projected drift</div>
      </Link>
      <Link href={`/projects/${projectId}?filter=at_risk`} className={`${box} border-slate-200 bg-white hover:bg-slate-50`}>
        <div className={`text-xl font-bold ${atRiskCount > 0 ? "text-amber-700" : "text-slate-900"}`}>{atRiskCount}</div>
        <div className="text-xs text-slate-500">at risk</div>
      </Link>
      <Link href={`/projects/${projectId}/health`} className={`${box} border-slate-200 bg-white hover:bg-slate-50`}>
        <div className="text-xl font-bold text-slate-900">{percentComplete}%</div>
        <div className="text-xs text-slate-500">complete</div>
      </Link>
      <Link
        href={`/projects/${projectId}/updates`}
        className={`${box} hover:bg-slate-50 ${stale ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
      >
        <div className={`text-xl font-bold ${stale ? "text-amber-700" : "text-slate-900"}`}>
          {lastUpdate ? `${lastUpdate.daysAgo}d ago` : "never"}
        </div>
        <div className="text-xs text-slate-500">last update</div>
      </Link>
    </div>
  );
}
