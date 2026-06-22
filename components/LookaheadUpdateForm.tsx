"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface LookaheadFormRow {
  externalUid: number;
  canonicalActivityKey: string;
  wbsCode: string | null;
  name: string;
  type: string;
  plannedStart: string | null;
  plannedFinish: string | null;
  slippage: "overdue" | "should-have-started" | "on-track";
  status: "not_started" | "in_progress" | "complete" | "completed_as_planned";
  actualStart: string;
  actualFinish: string;
  percentComplete: number | null;
  note: string;
}

const slipClass: Record<LookaheadFormRow["slippage"], string> = {
  overdue: "text-red-700",
  "should-have-started": "text-amber-700",
  "on-track": "text-slate-400",
};

export function LookaheadUpdateForm({
  updateId, projectId, rows, readOnly,
}: { updateId: string; projectId: string; rows: LookaheadFormRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [data, setData] = useState(rows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function patch(i: number, p: Partial<LookaheadFormRow>) {
    setData((d) => d.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  }

  async function save(finalize: boolean) {
    setBusy(true);
    setError(null);
    const entries = data.map((r) => ({
      activityExternalUid: r.externalUid,
      canonicalActivityKey: r.canonicalActivityKey,
      status: r.status === "completed_as_planned" ? "complete" : r.status,
      actualStart: r.actualStart || null,
      actualFinish: r.actualFinish || null,
      percentComplete: r.percentComplete,
      note: r.note || null,
    }));
    const res = await fetch(`/api/updates/${updateId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    if (!res.ok) { setError("Failed to save."); setBusy(false); return; }
    if (finalize) {
      const fin = await fetch(`/api/updates/${updateId}/finalize`, { method: "POST" });
      if (!fin.ok) { setError("Failed to finalize."); setBusy(false); return; }
    }
    setBusy(false);
    if (finalize) router.push(`/projects/${projectId}/updates`);
    else router.refresh();
  }

  return (
    <div>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {data.map((r, i) => (
          <li key={r.externalUid} className="px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <span>
                <span className="mr-2 text-xs text-slate-400">{r.wbsCode}</span>
                <span className="font-medium">{r.name}</span>
                {r.type === "milestone" && <span className="ml-2 text-xs text-indigo-600">◆</span>}
              </span>
              <span className="whitespace-nowrap text-xs text-slate-500">{r.plannedStart ?? "—"} → {r.plannedFinish ?? "—"}</span>
            </div>
            <div className={`mt-1 text-xs ${slipClass[r.slippage]}`}>{r.slippage}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <select
                disabled={readOnly}
                value={r.status}
                onChange={(e) => {
                  const value = e.target.value as LookaheadFormRow["status"];
                  if (value === "completed_as_planned") {
                    patch(i, {
                      status: "completed_as_planned",
                      actualStart: r.plannedStart ?? "",
                      actualFinish: r.plannedFinish ?? "",
                      percentComplete: 100,
                    });
                    return;
                  }
                  patch(i, { status: value });
                }}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
                aria-label="Status"
              >
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="complete">Complete</option>
                <option value="completed_as_planned" disabled={!r.plannedStart || !r.plannedFinish}>
                  Completed as Planned
                </option>
              </select>
              <input disabled={readOnly} type="date" value={r.actualStart} onChange={(e) => patch(i, { actualStart: e.target.value })} className="rounded border border-slate-300 px-2 py-1 text-sm" aria-label="Actual start" />
              <input disabled={readOnly} type="date" value={r.actualFinish} onChange={(e) => patch(i, { actualFinish: e.target.value })} className="rounded border border-slate-300 px-2 py-1 text-sm" aria-label="Actual finish" />
              <input disabled={readOnly} type="number" min={0} max={100} value={r.percentComplete ?? ""} onChange={(e) => patch(i, { percentComplete: e.target.value === "" ? null : Number(e.target.value) })} placeholder="% complete" className="rounded border border-slate-300 px-2 py-1 text-sm" aria-label="Percent complete" />
            </div>
            <input disabled={readOnly} value={r.note} onChange={(e) => patch(i, { note: e.target.value })} placeholder="Note (optional)" className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
          </li>
        ))}
      </ul>
      {!readOnly && (
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={() => save(false)} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">Save draft</button>
          <button disabled={busy} onClick={() => save(true)} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white">Finalize</button>
        </div>
      )}
    </div>
  );
}
