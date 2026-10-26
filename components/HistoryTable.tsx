"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { appPath } from "@/lib/http";
import type { ImportTier } from "@/lib/health/importTier";
import { TierBadge } from "@/components/TierBadge";

export interface HistoryRow {
  id: string;
  name: string;
  fy: number | null;
  buildingType: string | null;
  sizeSqFt: number | null;
  useInBenchmarks: boolean;
  schedules: number;
  start: string | null;
  finish: string | null;
  workDays: number | null;
  activities: number;
}
export interface HistoryGroup { label: string; rows: HistoryRow[] }
export interface HistoryImport {
  id: string;
  fileName: string;
  isBaseline: boolean;
  statusDate: string | null;
  start: string | null;
  finish: string | null;
  activities: number;
  tierOverride: string | null;
  tier: ImportTier;
  reasons: string[];
  logic: string;
}

/** Posts one edit to the admin history route, which answers with a redirect on success. */
async function save(projectId: string, fields: Record<string, string>): Promise<string | null> {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const res = await fetch(appPath(`/api/history/${projectId}`), { method: "POST", body, redirect: "manual" });
  if (res.ok || res.type === "opaqueredirect") return null;
  return (await res.json().catch(() => null))?.error?.message ?? "Save failed.";
}

const COLUMNS: { key: string; label: string; right?: boolean }[] = [
  { key: "name", label: "Project" }, { key: "fy", label: "FY" }, { key: "type", label: "Project type" },
  { key: "schedules", label: "Schedules", right: true }, { key: "start", label: "Start → finish" },
  { key: "days", label: "Work days", right: true }, { key: "activities", label: "Activities", right: true },
];

export function HistoryTable({ groups, admin, types, query, sort, dir, openId, openImports }: {
  groups: HistoryGroup[];
  admin: boolean;
  types: { sector: string; types: string[] }[];
  query: Record<string, string | undefined>;
  sort: string;
  dir: "asc" | "desc";
  openId: string | null;
  openImports: HistoryImport[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkType, setBulkType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = groups.flatMap((g) => g.rows);

  const href = (change: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => !!e[1]));
    for (const [k, v] of Object.entries(change)) if (v === null) p.delete(k); else p.set(k, v);
    return `/history?${p}`;
  };
  async function run(edits: [string, Record<string, string>][]) {
    setBusy(true);
    setError(null);
    for (const [id, fields] of edits) {
      const err = await save(id, fields);
      if (err) { setError(err); break; }
    }
    setBusy(false);
    router.refresh();
  }
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const typeOptions = types.map(({ sector, types }) => (
    <optgroup key={sector} label={sector}>{types.map((t) => <option key={t}>{t}</option>)}</optgroup>
  ));
  const cell = "px-2 py-2";

  return (
    <div>
      {error && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {admin && selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <b className="text-blue-900">{selected.size} selected</b>
          <select value={bulkType} onChange={(e) => setBulkType(e.target.value)} aria-label="Project type for selected" className="h-8 rounded border border-blue-300 bg-white px-2">
            <option value="">Set project type…</option>
            {typeOptions}
          </select>
          <button disabled={busy || !bulkType} onClick={() => run([...selected].map((id) => [id, { buildingType: bulkType }]))} className="h-8 rounded border border-blue-300 bg-white px-3 disabled:opacity-50">Apply</button>
          <button disabled={busy} onClick={() => run([...selected].map((id) => [id, { useInBenchmarks: "false" }]))} className="h-8 rounded border border-blue-300 bg-white px-3 disabled:opacity-50">Leave out of benchmarks</button>
          <button disabled={busy} onClick={() => run([...selected].map((id) => [id, { useInBenchmarks: "true" }]))} className="h-8 rounded border border-blue-300 bg-white px-3 disabled:opacity-50">Use in benchmarks</button>
          <button onClick={() => setSelected(new Set())} className="h-8 px-2 text-blue-700">Clear</button>
          {busy && <span className="text-blue-900">Saving…</span>}
        </div>
      )}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full min-w-[1000px] border-collapse text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="w-8 px-3 py-2">
                {admin && <input type="checkbox" aria-label="Select all" checked={selected.size === rows.length} onChange={(e) => setSelected(new Set(e.target.checked ? rows.map((r) => r.id) : []))} />}
              </th>
              {COLUMNS.map((c) => (
                <th key={c.key} className={`${cell} font-semibold ${c.right ? "text-right" : ""}`} aria-sort={sort === c.key ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                  <Link href={href({ sort: c.key, dir: sort === c.key && dir === "asc" ? "desc" : "asc" })} className="hover:text-slate-900">
                    {c.label}{sort === c.key ? (dir === "asc" ? " ▴" : " ▾") : ""}
                  </Link>
                </th>
              ))}
              <th className="px-3 py-2 text-center font-semibold">In benchmarks</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.label}>
                {g.label && (
                  <tr className="border-t border-slate-200 bg-slate-50">
                    <td colSpan={9} className="px-3 py-1.5 text-xs font-semibold text-slate-600">{g.label} · {g.rows.length}</td>
                  </tr>
                )}
                {g.rows.map((r) => {
                  const open = r.id === openId;
                  return (
                    <Fragment key={r.id}>
                      <tr className={`border-t border-slate-100 ${open ? "bg-slate-50" : "hover:bg-slate-50"}`}>
                        <td className="px-3 py-2">
                          {admin && <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}
                        </td>
                        <td className={`${cell} font-medium`}>
                          <Link href={href({ open: open ? null : r.id })} scroll={false} aria-expanded={open} className="inline-flex items-start gap-2 hover:text-blue-700">
                            <span aria-hidden className="w-3 text-slate-400">{open ? "▾" : "▸"}</span>{r.name}
                          </Link>
                        </td>
                        <td className={`${cell} text-slate-600`}>{r.fy ? `FY${r.fy}` : "—"}</td>
                        <td className="px-2 py-1">
                          {admin ? (
                            <select value={r.buildingType ?? ""} disabled={busy} onChange={(e) => run([[r.id, { buildingType: e.target.value }]])} aria-label={`Project type for ${r.name}`} className={`h-8 max-w-64 rounded border border-slate-200 bg-white px-1 ${r.buildingType ? "" : "text-amber-700"}`}>
                              <option value="">No project type</option>
                              {typeOptions}
                            </select>
                          ) : (r.buildingType ?? <span className="text-amber-700">No project type</span>)}
                        </td>
                        <td className={`${cell} text-right`}>{r.schedules}</td>
                        <td className={`${cell} whitespace-nowrap text-slate-700`}>{r.start ?? "—"} → {r.finish ?? "—"}</td>
                        <td className={`${cell} text-right`}>{r.workDays ?? "—"}</td>
                        <td className={`${cell} text-right`}>{r.activities}</td>
                        <td className="px-3 py-2 text-center">
                          {admin ? (
                            <input type="checkbox" checked={r.useInBenchmarks} disabled={busy} onChange={(e) => run([[r.id, { useInBenchmarks: String(e.target.checked) }]])} aria-label={`Use ${r.name} in benchmarks`} />
                          ) : (r.useInBenchmarks ? "✓" : "—")}
                        </td>
                      </tr>
                      {open && <OpenRow row={r} imports={openImports} admin={admin} busy={busy} run={run} />}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OpenRow({ row, imports, admin, busy, run }: {
  row: HistoryRow;
  imports: HistoryImport[];
  admin: boolean;
  busy: boolean;
  run: (edits: [string, Record<string, string>][]) => Promise<void>;
}) {
  const [size, setSize] = useState(row.sizeSqFt?.toString() ?? "");
  return (
    <tr className="bg-slate-50">
      <td />
      <td colSpan={8} className="px-2 pb-4 pt-1">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex flex-[0_1_260px] flex-col gap-2 rounded border border-slate-200 bg-white p-3 text-sm">
            {admin ? (
              <form onSubmit={(e) => { e.preventDefault(); run([[row.id, { sizeSqFt: size }]]); }} className="flex items-end gap-2">
                <label className="flex flex-col text-xs text-slate-600">Size (sq ft)
                  <input value={size} onChange={(e) => setSize(e.target.value)} inputMode="numeric" className="h-8 w-28 rounded border border-slate-300 px-2 text-sm" />
                </label>
                <button disabled={busy} className="h-8 rounded border border-slate-300 px-3 font-medium disabled:opacity-50">Save</button>
              </form>
            ) : (
              <span>Size: {row.sizeSqFt ? `${row.sizeSqFt.toLocaleString()} sf` : "—"}</span>
            )}
            <Link href={`/history/${row.id}`} className="text-blue-700 hover:underline">Open project page →</Link>
          </div>
          <div className="min-w-0 flex-[999_1_560px] overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full border-collapse text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Schedule file</th>
                  <th className="px-2 py-2 font-semibold">Status date</th>
                  <th className="px-2 py-2 font-semibold">Start → finish</th>
                  <th className="px-2 py-2 text-right font-semibold">Activities</th>
                  <th className="px-2 py-2 font-semibold">Logic checks</th>
                  <th className="px-2 py-2 font-semibold">Tier</th>
                  {admin && <th className="px-3 py-2 font-semibold">Override</th>}
                </tr>
              </thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <span className="break-words font-medium">{i.fileName}</span>
                      {i.isBaseline && <span className="ml-2 text-slate-500">baseline</span>}
                      {i.reasons.length > 0 && <ul className="mt-1 list-disc pl-4 text-slate-600">{i.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}
                    </td>
                    <td className="px-2 py-2 text-slate-600">{i.statusDate ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-600">{i.start ?? "—"} → {i.finish ?? "—"}</td>
                    <td className="px-2 py-2 text-right">{i.activities}</td>
                    <td className="px-2 py-2 text-slate-600">{i.logic} pass</td>
                    <td className="px-2 py-2"><TierBadge tier={i.tier} /></td>
                    {admin && (
                      <td className="px-3 py-1.5">
                        <select value={i.tierOverride ?? ""} disabled={busy} onChange={(e) => run([[row.id, { importId: i.id, tierOverride: e.target.value }]])} aria-label={`Tier override for ${i.fileName}`} className="h-7 rounded border border-slate-200 bg-white px-1">
                          <option value="">Automatic</option>
                          <option value="rough">Rough</option>
                          <option value="junk">Too small</option>
                        </select>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </td>
    </tr>
  );
}
