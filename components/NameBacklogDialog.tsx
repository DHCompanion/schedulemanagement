"use client";

import { useRef, useState } from "react";
import { appPath } from "@/lib/http";
import type { BacklogProgress, BacklogRow } from "@/lib/normalize/nameBacklog";

const API = "/api/history/names/backlog";

/** The review backlog, one name at a time, with the suggested outcome first. Settled names drop off, so closing loses nothing. */
export function NameBacklogDialog({ scopes }: { scopes: string[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<BacklogRow[]>([]);
  const [progress, setProgress] = useState<BacklogProgress | null>(null);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [high, setHigh] = useState<{ rawName: string; suggestion: string }[]>([]);
  const [confirming, setConfirming] = useState(false);
  // ponytail: skips live until the page reloads and cap at 475 (the API's 500 limit).
  const [skipped] = useState(() => new Set<string>());

  async function load() {
    const res = await fetch(appPath(`${API}?limit=${25 + skipped.size}`));
    const data = await res.json();
    setRows(((data.rows ?? []) as BacklogRow[]).filter((r) => !skipped.has(r.normalizedName)));
    setProgress(data.progress ?? null);
    setHigh(data.high ?? []);
  }

  async function open() {
    const d = ref.current;
    if (d?.showModal) d.showModal();
    else d?.setAttribute("open", "");
    await load();
  }

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    const res = await fetch(appPath(API), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error?.message ?? "Failed to save.");
      return null;
    }
    return data;
  }

  async function act(body: Record<string, unknown>) {
    if (!(await post({ name: rows[0].normalizedName, ...body }))) return;
    setOther("");
    const rest = rows.slice(1);
    setRows(rest);
    if (rest.length < 5) await load();
  }

  async function skip() {
    skipped.add(rows[0].normalizedName);
    setOther("");
    const rest = rows.slice(1);
    setRows(rest);
    if (rest.length < 5) await load();
  }

  async function approveHigh() {
    setConfirming(false);
    const data = await post({ approveHigh: true });
    if (data) {
      setMessage(`Mapped ${data.approved} names.`);
      await load();
    }
  }

  const r = rows[0];
  const btn = "rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50";
  const suggested = r && (r.kind === "map" || r.kind === "new") && r.suggestion;

  return (
    <>
      <button type="button" onClick={open} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Review backlog</button>
      <dialog ref={ref} aria-label="Name review backlog" className="w-[min(100%-2rem,48rem)] rounded-lg p-0 backdrop:bg-slate-900/40">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold">Name review backlog</h2>
          <button type="button" onClick={() => ref.current?.close()} className="text-sm text-slate-500" aria-label="Close">Close</button>
        </div>
        {progress && (
          <div className="px-4 pt-3">
            <div className="h-2 overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuenow={Math.round(progress.coverage * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Task coverage">
              <div className={`h-full ${progress.coverage >= 0.95 ? "bg-emerald-500" : "bg-blue-600"}`} style={{ width: `${Math.round(progress.coverage * 100)}%` }} />
            </div>
            <p className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-slate-600">
              <span>{Math.round(progress.coverage * 100)}% of tasks covered · target 95%</span>
              <span>{progress.settledNames} of {progress.names} names done</span>
            </p>
          </div>
        )}
        <div className="px-4 py-3">
          {!r ? (
            <p className="text-sm text-slate-600">{progress ? "Nothing left to review." : "Loading…"}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span className="break-words text-lg font-medium">{r.rawName}</span>
                <span className="text-xs text-slate-500">{r.taskCount} tasks · {r.projectCount} project{r.projectCount === 1 ? "" : "s"}</span>
              </div>
              <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                {r.samples.map((s, i) => (
                  <li key={i}>{s.project}{s.type ? ` (${s.type})` : ""}{s.parent ? ` · under "${s.parent}"` : ""} · {s.days}d</li>
                ))}
              </ul>
              <div className="mt-3 rounded border border-blue-200 bg-blue-50/60 px-3 py-2 text-sm">
                <span className="font-medium">Suggested: </span>
                {r.kind === "map" ? r.suggestion : r.kind === "new" ? `add "${r.suggestion}" as a new standard name` : r.kind === "coarse" ? `coarse${r.covers.length ? ` (${r.covers.join(" + ")})` : ""}` : r.kind}
                <span className={`ml-2 rounded px-1.5 text-xs ${r.confidence === "high" ? "bg-emerald-100 text-emerald-800" : r.confidence === "medium" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"}`}>{r.confidence}</span>
                {r.reason && <p className="mt-0.5 text-xs text-slate-600">{r.reason}</p>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {suggested && (
                  <button type="button" disabled={busy} onClick={() => act({ action: r.kind, scope: r.suggestion })} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                    {r.kind === "map" ? `Approve: ${r.suggestion}` : `Add and map: ${r.suggestion}`}
                  </button>
                )}
                {r.kind === "coarse" && <button type="button" disabled={busy} onClick={() => act({ action: "coarse", covers: r.covers })} className={btn}>Approve coarse</button>}
                <button type="button" disabled={busy} onClick={() => act({ action: "coarse", covers: [] })} className={btn}>Coarse</button>
                <button type="button" disabled={busy} onClick={() => act({ action: "procurement" })} className={btn}>Procurement</button>
                <button type="button" disabled={busy} onClick={() => act({ action: "ignore" })} className={btn}>Ignore</button>
                <button type="button" disabled={busy} onClick={skip} className={btn}>Skip</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <input list="backlog-standard-names" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Another standard name" placeholder="Another standard name…"
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm" />
                <datalist id="backlog-standard-names">{scopes.map((s) => <option key={s} value={s} />)}</datalist>
                <button type="button" disabled={busy || !other.trim()} onClick={() => act({ action: "map", scope: other.trim() })} className={btn}>Map</button>
                <button type="button" disabled={busy || !other.trim() || scopes.includes(other.trim())} onClick={() => act({ action: "new", scope: other.trim() })} className={btn}>Add as new name</button>
              </div>
            </>
          )}
          {message && <p role="status" className="mt-2 text-sm text-slate-700">{message}</p>}
        </div>
        {high.length > 0 && (
          <div className="border-t border-slate-200 px-4 py-3">
            {!confirming ? (
              <button type="button" disabled={busy} onClick={() => setConfirming(true)} className={btn}>Approve all high-confidence ({high.length})</button>
            ) : (
              <>
                <p className="text-sm font-medium">Map {high.length === 1 ? "this name" : `these ${high.length} names`} to the suggested standard name?</p>
                <ul className="my-2 max-h-48 overflow-y-auto rounded border border-slate-200 px-3 py-1 text-xs text-slate-700">
                  {high.map((h) => <li key={h.rawName}>{h.rawName} → {h.suggestion}</li>)}
                </ul>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={approveHigh} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Map {high.length} name{high.length === 1 ? "" : "s"}</button>
                  <button type="button" onClick={() => setConfirming(false)} className={btn}>Cancel</button>
                </div>
              </>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
