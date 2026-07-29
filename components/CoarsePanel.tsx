"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { appPath } from "@/lib/http";

export interface CoarseNameRow {
  name: string;
  count: number;
  finerScopes: string[];
}

const PAGE = 50;

export function CoarsePanel({ rows, isAdmin }: { rows: CoarseNameRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  }, [rows, q]);

  async function save() {
    setBusy(true);
    setError(null);
    const failures: string[] = [];
    for (const [name, raw] of Object.entries(drafts)) {
      for (const finerScope of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
        const res = await fetch(appPath("/api/completeness/split-rules"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coarseScope: name, finerScope }),
        });
        // Checked, not fire-and-forget: an admin-only route rejecting a
        // non-admin session used to fail silently here, and the schedule came
        // back with zero coarse activities and no explanation.
        if (!res.ok) failures.push((await res.json())?.error?.message ?? `Could not mark "${name}".`);
      }
    }
    setBusy(false);
    if (failures.length) {
      setError(failures[0]);
      return;
    }
    setDrafts({});
    router.refresh();
  }

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Mark a scope as too coarse</h2>
      <p className="mb-2 text-xs text-slate-500">
        {isAdmin
          ? "List the finer scopes an activity should really be tracked as, comma-separated. Every activity with that name gets flagged."
          : "Only an admin can mark scopes as coarse."}
      </p>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search activity names"
        className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
      />
      <p className="mb-2 text-xs text-slate-500">
        {matches.length} distinct name{matches.length === 1 ? "" : "s"} in this schedule
      </p>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {matches.slice(0, limit).map((r) => (
          <li key={r.name} className="px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{r.name}</span>
              <span className="whitespace-nowrap text-xs text-slate-400">
                {r.count} activit{r.count === 1 ? "y" : "ies"}
              </span>
            </div>
            {r.finerScopes.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {r.finerScopes.map((s) => (
                  <span key={s} className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">{s}</span>
                ))}
              </div>
            )}
            {isAdmin && (
              <input
                value={drafts[r.name] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [r.name]: e.target.value }))}
                placeholder="Too coarse? Finer scopes, comma-separated (e.g. Drywall Hang, Drywall Tape)"
                className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              />
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {matches.length > limit && (
          <button onClick={() => setLimit((n) => n + PAGE)} className="rounded border border-slate-300 px-3 py-2 text-sm font-medium">
            Show more ({matches.length - limit} left)
          </button>
        )}
        {isAdmin && (
          <button
            disabled={busy || Object.keys(drafts).length === 0}
            onClick={save}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save coarse markings"}
          </button>
        )}
      </div>
    </section>
  );
}
