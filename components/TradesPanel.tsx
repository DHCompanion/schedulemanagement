"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface DisciplineRow { canonicalScope: string; suggestions: string[]; }
export interface AssignmentRow { discipline: string; currentCompany: string; }

export function TradesPanel({ projectId, disciplineRows, assignmentRows, knownDisciplines, partners }: {
  projectId: string; disciplineRows: DisciplineRow[]; assignmentRows: AssignmentRow[]; knownDisciplines: string[]; partners: string[];
}) {
  const router = useRouter();
  const [disc, setDisc] = useState<Record<string, string>>({});
  const [comp, setComp] = useState<Record<string, string>>(() => Object.fromEntries(assignmentRows.map((r) => [r.discipline, r.currentCompany])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-6">
      <datalist id="known-disciplines">{knownDisciplines.map((d) => <option key={d} value={d} />)}</datalist>
      <datalist id="known-partners">{partners.map((p) => <option key={p} value={p} />)}</datalist>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Scope → discipline (global)</h2>
        {disciplineRows.length === 0 ? (
          <p className="text-sm text-slate-500">No scopes need a discipline.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
            {disciplineRows.map((r) => (
              <li key={r.canonicalScope} className="px-3 py-3">
                <div className="font-medium">{r.canonicalScope}</div>
                {r.suggestions.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.suggestions.map((s) => (
                      <button key={s} onClick={() => setDisc((v) => ({ ...v, [r.canonicalScope]: s }))} className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">{s}</button>
                    ))}
                  </div>
                )}
                <input list="known-disciplines" value={disc[r.canonicalScope] ?? ""} onChange={(e) => setDisc((v) => ({ ...v, [r.canonicalScope]: e.target.value }))} placeholder="Trade discipline" className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Discipline → trade partner (this project)</h2>
        {assignmentRows.length === 0 ? (
          <p className="text-sm text-slate-500">Map scopes to disciplines and save, then assign companies here.</p>
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
      </section>

      <button disabled={busy} onClick={save} className="self-start rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
    </div>
  );
}
