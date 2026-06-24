"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DisciplineRow { canonicalScope: string; suggestions: string[]; }
export interface AssignmentRow { discipline: string; currentCompany: string; }

type Tab = "assignment" | "unmapped" | "dismissed";

export function TradesPanel({ projectId, disciplineRows, assignmentRows, knownDisciplines, partners, dismissedScopes }: {
  projectId: string; disciplineRows: DisciplineRow[]; assignmentRows: AssignmentRow[]; knownDisciplines: string[]; partners: string[]; dismissedScopes: string[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("assignment");
  const [disc, setDisc] = useState<Record<string, string>>({});
  const [comp, setComp] = useState<Record<string, string>>(() => Object.fromEntries(assignmentRows.map((r) => [r.discipline, r.currentCompany])));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDiscipline, setBulkDiscipline] = useState("");
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleSelected(scope: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  function applyBulkDiscipline() {
    const value = bulkDiscipline.trim();
    if (!value || selected.size === 0) return;
    setDisc((prev) => {
      const next = { ...prev };
      for (const scope of selected) next[scope] = value;
      return next;
    });
    setSelected(new Set());
    setBulkDiscipline("");
  }

  async function save() {
    setBusy(true);
    setError(null);
    const disciplines = Object.entries(disc).filter(([, v]) => v.trim()).map(([canonicalScope, discipline]) => ({ canonicalScope, discipline: discipline.trim() }));
    const assignments = Object.entries(comp).filter(([, v]) => v.trim()).map(([discipline, companyName]) => ({ discipline, companyName: companyName.trim() }));
    const res = await fetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, disciplines, assignments }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Save failed.");
      return;
    }
    router.refresh();
  }

  async function dismiss(scope: string) {
    setRowBusy(scope);
    setError(null);
    const res = await fetch("/api/trades/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, canonicalScope: scope }),
    });
    setRowBusy(null);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Dismiss failed.");
      return;
    }
    router.refresh();
  }

  async function restore(scope: string) {
    setRowBusy(scope);
    setError(null);
    const res = await fetch("/api/trades/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, canonicalScope: scope }),
    });
    setRowBusy(null);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Restore failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <datalist id="known-disciplines">{knownDisciplines.map((d) => <option key={d} value={d} />)}</datalist>
      <datalist id="known-partners">{partners.map((p) => <option key={p} value={p} />)}</datalist>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex gap-1 border-b border-slate-200">
        {([
          ["assignment", "Trade Assignment"],
          ["unmapped", `Unmapped Activities (${disciplineRows.length})`],
          ["dismissed", `Dismissed (${dismissedScopes.length})`],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-medium ${tab === key ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500 hover:text-slate-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "assignment" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Discipline → trade partner (this project)</h2>
          {assignmentRows.length === 0 ? (
            <p className="text-sm text-slate-500">Map scopes to disciplines on the Unmapped Activities tab, then assign companies here.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
              {assignmentRows.map((r) => (
                <li key={r.discipline} className="px-3 py-3">
                  <div className="font-medium">{r.discipline}</div>
                  <input list="known-partners" value={comp[r.discipline] ?? ""} onChange={(e) => setComp((v) => ({ ...v, [r.discipline]: e.target.value }))} placeholder="Trade partner company" className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                </li>
              ))}
            </ul>
          )}
          <button disabled={busy} onClick={save} className="self-start rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </section>
      )}

      {tab === "unmapped" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Scope → discipline (global)</h2>
          {disciplineRows.length === 0 ? (
            <p className="text-sm text-slate-500">No scopes need a discipline.</p>
          ) : (
            <>
              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded border border-slate-300 bg-slate-50 px-3 py-2">
                  <span className="text-sm text-slate-600">{selected.size} selected</span>
                  <input
                    list="known-disciplines"
                    value={bulkDiscipline}
                    onChange={(e) => setBulkDiscipline(e.target.value)}
                    placeholder="Trade discipline"
                    className="min-w-[10rem] flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                  <button onClick={applyBulkDiscipline} className="whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white">
                    Apply to {selected.size} selected
                  </button>
                </div>
              )}
              <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
                {disciplineRows.map((r) => (
                  <li key={r.canonicalScope} className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={selected.has(r.canonicalScope)} onChange={() => toggleSelected(r.canonicalScope)} className="mt-1" />
                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium">{r.canonicalScope}</div>
                          <button
                            disabled={rowBusy === r.canonicalScope}
                            onClick={() => dismiss(r.canonicalScope)}
                            className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                          >
                            {rowBusy === r.canonicalScope ? "Working…" : "Dismiss"}
                          </button>
                        </div>
                        {r.suggestions.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.suggestions.map((s) => (
                              <button key={s} onClick={() => setDisc((v) => ({ ...v, [r.canonicalScope]: s }))} className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">{s}</button>
                            ))}
                          </div>
                        )}
                        <input list="known-disciplines" value={disc[r.canonicalScope] ?? ""} onChange={(e) => setDisc((v) => ({ ...v, [r.canonicalScope]: e.target.value }))} placeholder="Trade discipline" className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button disabled={busy} onClick={save} className="self-start rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </section>
      )}

      {tab === "dismissed" && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-slate-700">Dismissed scopes (this project)</h2>
          {dismissedScopes.length === 0 ? (
            <p className="text-sm text-slate-500">No dismissed scopes.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
              {dismissedScopes.map((scope) => (
                <li key={scope} className="flex items-center justify-between gap-3 px-3 py-3">
                  <span className="font-medium">{scope}</span>
                  <button
                    disabled={rowBusy === scope}
                    onClick={() => restore(scope)}
                    className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                  >
                    {rowBusy === scope ? "Working…" : "Restore"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
