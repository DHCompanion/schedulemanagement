"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SplitRuleRow {
  coarseScope: string;
  finerScopes: string[];
}

export function SplitRulesPanel({ rules, knownScopes }: { rules: SplitRuleRow[]; knownScopes: string[] }) {
  const router = useRouter();
  const [coarse, setCoarse] = useState("");
  const [finer, setFiner] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE", coarseScope: string, finerScope: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/completeness/split-rules", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coarseScope, finerScope }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Save failed.");
      return;
    }
    router.refresh();
  }

  async function add() {
    if (!coarse.trim() || !finer.trim()) return;
    await call("POST", coarse, finer);
    setFiner("");
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Split rules</h2>
      <p className="mb-2 text-xs text-slate-500">
        Mark a standard scope as coarse and list the finer scopes it should really be tracked as.
      </p>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <datalist id="known-scopes-split">
        {knownScopes.map((s) => <option key={s} value={s} />)}
      </datalist>

      {rules.length === 0 ? (
        <p className="mb-3 text-sm text-slate-500">No split rules defined yet.</p>
      ) : (
        <ul className="mb-3 divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {rules.map((r) => (
            <li key={r.coarseScope} className="px-3 py-3">
              <div className="font-medium">{r.coarseScope}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.finerScopes.map((f) => (
                  <button
                    key={f}
                    disabled={busy}
                    onClick={() => call("DELETE", r.coarseScope, f)}
                    className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200"
                    title="Remove"
                  >
                    {f} ×
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          list="known-scopes-split"
          value={coarse}
          onChange={(e) => setCoarse(e.target.value)}
          placeholder="Coarse scope"
          className="min-w-[10rem] flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <input
          list="known-scopes-split"
          value={finer}
          onChange={(e) => setFiner(e.target.value)}
          placeholder="Finer scope"
          className="min-w-[10rem] flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <button disabled={busy} onClick={add} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          Add
        </button>
      </div>
    </section>
  );
}
