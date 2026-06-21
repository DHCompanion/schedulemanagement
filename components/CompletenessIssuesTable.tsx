"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompletenessIssue } from "@/lib/completeness/completenessChecks";

export function CompletenessIssuesTable({ projectId, issues }: { projectId: string; issues: CompletenessIssue[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const coarseScopes = useMemo(() => [...new Set(issues.map((i) => i.coarseScope))].sort(), [issues]);

  const view = useMemo(() => {
    let r = issues;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      r = r.filter((i) => i.name.toLowerCase().includes(needle) || (i.wbsCode ?? "").includes(needle) || String(i.externalId ?? "").includes(needle));
    }
    if (scope !== "all") r = r.filter((i) => i.coarseScope === scope);
    return r;
  }, [issues, q, scope]);

  async function dismiss(issue: CompletenessIssue) {
    const key = `${issue.canonicalActivityKey}::${issue.coarseScope}`;
    setBusyKey(key);
    await fetch("/api/completeness/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, canonicalActivityKey: issue.canonicalActivityKey, coarseScope: issue.coarseScope }),
    });
    setBusyKey(null);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / WBS / ID"
          className="min-w-[12rem] flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <select value={scope} onChange={(e) => setScope(e.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm">
          <option value="all">All coarse scopes</option>
          {coarseScopes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <p className="mb-2 text-xs text-slate-500">{view.length} flagged activities</p>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {view.map((i) => {
          const key = `${i.canonicalActivityKey}::${i.coarseScope}`;
          return (
            <li key={key} className="px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <span>
                  <span className="mr-2 text-xs text-slate-400">{i.wbsCode}</span>
                  <span className="font-medium">{i.name}</span>
                </span>
                <button
                  disabled={busyKey === key}
                  onClick={() => dismiss(i)}
                  className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                >
                  {busyKey === key ? "Dismissing…" : "Dismiss"}
                </button>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{i.coarseScope}</span>
                should be tracked as: {i.finerScopes.join(", ")}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
