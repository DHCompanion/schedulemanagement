"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface UnmappedRow {
  rawName: string;
  count: number;
  suggestions: string[];
}

export function NormalizePanel({ projectId, rows, knownScopes }: { projectId: string; rows: UnmappedRow[]; knownScopes: string[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(rawName: string, scope: string) {
    setValues((v) => ({ ...v, [rawName]: scope }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    const mappings = Object.entries(values)
      .filter(([, s]) => s.trim())
      .map(([rawName, canonicalScope]) => ({ rawName, canonicalScope: canonicalScope.trim() }));
    const res = await fetch("/api/normalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Save failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <datalist id="known-scopes">
        {knownScopes.map((s) => <option key={s} value={s} />)}
      </datalist>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {rows.map((r) => (
          <li key={r.rawName} className="px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{r.rawName}</span>
              <span className="text-xs text-slate-400">{r.count} activit{r.count === 1 ? "y" : "ies"}</span>
            </div>
            {r.suggestions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {r.suggestions.map((s) => (
                  <button key={s} onClick={() => set(r.rawName, s)} className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">{s}</button>
                ))}
              </div>
            )}
            <input
              list="known-scopes"
              value={values[r.rawName] ?? ""}
              onChange={(e) => set(r.rawName, e.target.value)}
              placeholder="Standard scope"
              className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </li>
        ))}
      </ul>
      <button disabled={busy} onClick={save} className="mt-4 rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Saving…" : "Save mappings"}
      </button>
    </div>
  );
}
