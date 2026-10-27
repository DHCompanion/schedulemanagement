"use client";

import { useState } from "react";

/** The draft's name checkboxes with a search box. Hidden names stay in the form, so ticked ones still submit. */
export function DraftChecklist({ items }: { items: { name: string; share: number; checked: boolean }[] }) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (name: string) => words.every((w) => name.toLowerCase().includes(w));
  return (
    <>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names" aria-label="Search names"
        className="mb-2 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm sm:w-72" />
      <div className="mb-3 grid max-h-96 grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2">
        {items.map((c) => (
          <label key={c.name} className={`items-center gap-2 py-0.5 text-sm ${shown(c.name) ? "flex" : "hidden"}`}>
            <input type="checkbox" name="scope" value={c.name} defaultChecked={c.checked} />
            <span>{c.name}</span>
            <span className="text-xs text-slate-400">{Math.round(c.share * 100)}%</span>
          </label>
        ))}
        {!items.some((c) => shown(c.name)) && <p className="text-sm text-slate-500">No names match. Add one below.</p>}
      </div>
    </>
  );
}
