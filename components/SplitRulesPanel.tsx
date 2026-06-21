"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SplitRuleRow {
  coarseScope: string;
  finerScopes: string[];
}

export function SplitRulesPanel({ rules, isAdmin }: { rules: SplitRuleRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(coarseScope: string, finerScope: string) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/completeness/split-rules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coarseScope, finerScope }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "Remove failed.");
      return;
    }
    router.refresh();
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Split rules</h2>
      <p className="mb-2 text-xs text-slate-500">
        Scopes marked coarse and the finer scopes they should really be tracked as. Add new rules inline above when mapping an activity name.
      </p>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {rules.length === 0 ? (
        <p className="text-sm text-slate-500">No split rules defined yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {rules.map((r) => (
            <li key={r.coarseScope} className="px-3 py-3">
              <div className="font-medium">{r.coarseScope}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.finerScopes.map((f) =>
                  isAdmin ? (
                    <button key={f} disabled={busy} onClick={() => remove(r.coarseScope, f)} className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200" title="Remove">
                      {f} ×
                    </button>
                  ) : (
                    <span key={f} className="rounded bg-slate-100 px-2 py-1 text-xs">{f}</span>
                  ),
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
