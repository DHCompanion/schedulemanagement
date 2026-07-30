"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompletenessIssue } from "@/lib/completeness/completenessChecks";
import { sendJson } from "@/lib/http";
import { BusyButton } from "@/components/BusyButton";

export function CompletenessIssuesTable({ projectId, issues }: { projectId: string; issues: CompletenessIssue[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    // Deliberately ignores the result — dismiss refreshes and shows no error
    // even when the request fails. That is current behaviour being preserved,
    // not endorsed; see the component test for the same note.
    await sendJson("/api/completeness/dismiss", { projectId, canonicalActivityKey: issue.canonicalActivityKey, coarseScope: issue.coarseScope });
    setBusyKey(null);
    router.refresh();
  }

  async function accept(issue: CompletenessIssue) {
    const key = `${issue.canonicalActivityKey}::${issue.coarseScope}`;
    const matching = issues.filter((i) => i.coarseScope === issue.coarseScope).length;
    const confirmed = window.confirm(
      `Replace ${matching} activit${matching === 1 ? "y" : "ies"} named "${issue.coarseScope}" with ` +
        `${issue.finerScopes.length} parallel activities each — ${issue.finerScopes.join(", ")} — ` +
        `${matching * issue.finerScopes.length} tasks in total, each inheriting its predecessors, ` +
        `successors, and duration. Activities you dismissed are left alone. Continue?`,
    );
    if (!confirmed) return;
    setBusyKey(key);
    setError(null);
    const err = await sendJson("/api/completeness/accept", { projectId, coarseScope: issue.coarseScope });
    setBusyKey(null);
    if (err) {
      setError(err);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
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
          const busy = busyKey === key;
          return (
            <li key={key} className="px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <span>
                  <span className="mr-2 text-xs text-slate-400">{i.wbsCode}</span>
                  <span className="font-medium">{i.name}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <BusyButton
                    busy={busy}
                    label="Accept"
                    onClick={() => accept(i)}
                    className="whitespace-nowrap rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                  />
                  <BusyButton
                    busy={busy}
                    label="Dismiss"
                    onClick={() => dismiss(i)}
                    className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100"
                  />
                </span>
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
