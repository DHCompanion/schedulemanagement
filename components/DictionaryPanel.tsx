"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendJson } from "@/lib/http";

export interface MappedRow {
  rawName: string;
  canonicalScope: string;
  count: number;
}

export function DictionaryPanel({ rows, isAdmin }: { rows: MappedRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unmap(rawName: string) {
    setBusy(true);
    setError(null);
    const err = await sendJson("/api/normalize", { rawName }, "DELETE");
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    router.refresh();
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Already mapped</h2>
      <p className="mb-2 text-xs text-slate-500">
        Names in this schedule that already have a standard scope. Unmapping one returns it to the review list above
        {isAdmin ? "." : " — admin only."}
      </p>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing mapped yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
          {rows.map((r) => (
            <li key={r.rawName} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.canonicalScope}</span>
                <span className="block truncate text-xs text-slate-500">{r.rawName} · {r.count}</span>
              </span>
              {isAdmin && (
                <button
                  disabled={busy}
                  onClick={() => unmap(r.rawName)}
                  className="whitespace-nowrap rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                >
                  Unmap
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
