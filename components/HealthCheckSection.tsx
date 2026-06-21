"use client";

import { useMemo, useState } from "react";
import type { HealthIssue } from "@/lib/health/dateChecks";

export function HealthCheckSection({ title, issues }: { title: string; issues: HealthIssue[] }) {
  const [q, setQ] = useState("");

  const view = useMemo(() => {
    if (!q.trim()) return issues;
    const needle = q.trim().toLowerCase();
    return issues.filter(
      (i) => i.name.toLowerCase().includes(needle) || (i.wbsCode ?? "").includes(needle) || String(i.externalId ?? "").includes(needle),
    );
  }, [issues, q]);

  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${issues.length === 0 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
          {issues.length === 0 ? "Clean" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {issues.length > 0 && (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name / WBS / ID"
            className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
            {view.map((i, idx) => (
              <li key={`${i.activityId}-${idx}`} className="px-3 py-2">
                <span className="mr-2 text-xs text-slate-400">{i.wbsCode}</span>
                <span className="font-medium">{i.name}</span>
                <div className="mt-1 text-xs text-slate-600">{i.message}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
