"use client";

import { useMemo, useState } from "react";
import type { HealthIssue, HealthCheck, HealthSeverity } from "@/lib/health/dateChecks";

const CHECK_LABELS: Record<HealthCheck, string> = {
  out_of_envelope: "Out of range",
  future_actual: "Future actual",
  missing_dates: "Missing dates",
  percent_contradiction: "% contradiction",
};

const SEVERITY_BADGE: Record<HealthSeverity, string> = {
  error: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
};

type SevFilter = "all" | HealthSeverity;
type ChkFilter = "all" | HealthCheck;

export function HealthIssuesTable({ issues }: { issues: HealthIssue[] }) {
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<SevFilter>("all");
  const [chk, setChk] = useState<ChkFilter>("all");

  const view = useMemo(() => {
    let r = issues;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      r = r.filter(
        (i) => i.name.toLowerCase().includes(needle) || (i.wbsCode ?? "").includes(needle) || String(i.externalId ?? "").includes(needle),
      );
    }
    if (sev !== "all") r = r.filter((i) => i.severity === sev);
    if (chk !== "all") r = r.filter((i) => i.check === chk);
    return r;
  }, [issues, q, sev, chk]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / WBS / ID"
          className="min-w-[12rem] flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <select value={sev} onChange={(e) => setSev(e.target.value as SevFilter)} className="rounded border border-slate-300 px-2 py-2 text-sm">
          <option value="all">All severities</option>
          <option value="error">Errors</option>
          <option value="warning">Warnings</option>
        </select>
        <select value={chk} onChange={(e) => setChk(e.target.value as ChkFilter)} className="rounded border border-slate-300 px-2 py-2 text-sm">
          <option value="all">All checks</option>
          {(Object.keys(CHECK_LABELS) as HealthCheck[]).map((c) => (
            <option key={c} value={c}>{CHECK_LABELS[c]}</option>
          ))}
        </select>
      </div>
      <p className="mb-2 text-xs text-slate-500">{view.length} issues</p>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {view.map((i, idx) => (
          <li key={`${i.activityId}-${i.check}-${idx}`} className="px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <span>
                <span className="mr-2 text-xs text-slate-400">{i.wbsCode}</span>
                <span className="font-medium">{i.name}</span>
              </span>
              <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_BADGE[i.severity]}`}>{i.severity}</span>
            </div>
            <div className="mt-1 text-xs text-slate-600">
              <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{CHECK_LABELS[i.check]}</span>
              {i.message}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
