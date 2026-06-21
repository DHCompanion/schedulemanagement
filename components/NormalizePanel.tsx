"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface UnmappedRow {
  rawName: string;
  count: number;
  suggestions: string[];
}

export function NormalizePanel({
  projectId,
  rows,
  knownScopes,
  isAdmin,
}: {
  projectId: string;
  rows: UnmappedRow[];
  knownScopes: string[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [splits, setSplits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(rawName: string, scope: string) {
    setValues((v) => ({ ...v, [rawName]: scope }));
  }

  function setSplit(rawName: string, finerScopes: string) {
    setSplits((s) => ({ ...s, [rawName]: finerScopes }));
  }

  function useAsIs(rawName: string) {
    set(rawName, rawName);
  }

  function acceptAllAsIs() {
    setValues((v) => {
      const next = { ...v };
      for (const r of rows) if (!next[r.rawName]?.trim()) next[r.rawName] = r.rawName;
      return next;
    });
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
    if (!res.ok) {
      setBusy(false);
      setError((await res.json())?.error?.message ?? "Save failed.");
      return;
    }
    for (const [rawName, finerRaw] of Object.entries(splits)) {
      const coarseScope = values[rawName]?.trim();
      if (!coarseScope || !finerRaw.trim()) continue;
      for (const finerScope of finerRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
        await fetch("/api/completeness/split-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coarseScope, finerScope }),
        });
      }
    }
    setBusy(false);
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
            <div className="mt-1 flex flex-wrap gap-1">
              <button onClick={() => useAsIs(r.rawName)} className="rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100">Use as-is</button>
              {r.suggestions.map((s) => (
                <button key={s} onClick={() => set(r.rawName, s)} className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">{s}</button>
              ))}
            </div>
            <input
              list="known-scopes"
              value={values[r.rawName] ?? ""}
              onChange={(e) => set(r.rawName, e.target.value)}
              placeholder="Standard scope"
              className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
            {isAdmin && (
              <input
                value={splits[r.rawName] ?? ""}
                onChange={(e) => setSplit(r.rawName, e.target.value)}
                placeholder="Coarse? List finer scopes, comma-separated (e.g. Drywall Hang, Drywall Tape)"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-600"
              />
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={busy} onClick={acceptAllAsIs} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
          Accept all shown as-is
        </button>
        <button disabled={busy} onClick={save} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save mappings"}
        </button>
      </div>
    </div>
  );
}
