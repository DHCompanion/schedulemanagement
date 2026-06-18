"use client";

import { useMemo, useState } from "react";

export interface ActivityRow {
  id: string;
  externalId: number | null;
  wbsCode: string | null;
  name: string;
  type: string;
  isCritical: boolean;
  outlineLevel: number;
  plannedStart: string | null;
  plannedFinish: string | null;
  percentComplete: number | null;
  totalSlackDays: number | null;
  durationDays: number | null;
  customFields: Record<string, string>;
}

type Filter = "all" | "milestones" | "critical" | "in_progress";
type Sort = "wbs" | "start" | "slack";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 10);
}

export function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("wbs");
  const [openId, setOpenId] = useState<string | null>(null);

  const view = useMemo(() => {
    let r = rows;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      r = r.filter(
        (a) => a.name.toLowerCase().includes(needle) || (a.wbsCode ?? "").includes(needle) || String(a.externalId ?? "").includes(needle),
      );
    }
    if (filter === "milestones") r = r.filter((a) => a.type === "milestone");
    if (filter === "critical") r = r.filter((a) => a.isCritical);
    if (filter === "in_progress") r = r.filter((a) => (a.percentComplete ?? 0) > 0 && (a.percentComplete ?? 0) < 100);
    const sorted = [...r];
    if (sort === "wbs") sorted.sort((a, b) => (a.wbsCode ?? "").localeCompare(b.wbsCode ?? "", undefined, { numeric: true }));
    if (sort === "start") sorted.sort((a, b) => (a.plannedStart ?? "").localeCompare(b.plannedStart ?? ""));
    if (sort === "slack") sorted.sort((a, b) => (a.totalSlackDays ?? Infinity) - (b.totalSlackDays ?? Infinity));
    return sorted;
  }, [rows, q, filter, sort]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / WBS / ID"
          className="min-w-[12rem] flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="rounded border border-slate-300 px-2 py-2 text-sm">
          <option value="all">All</option>
          <option value="milestones">Milestones</option>
          <option value="critical">Critical</option>
          <option value="in_progress">In progress</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded border border-slate-300 px-2 py-2 text-sm">
          <option value="wbs">Sort: WBS</option>
          <option value="start">Sort: Start</option>
          <option value="slack">Sort: Float</option>
        </select>
      </div>
      <p className="mb-2 text-xs text-slate-500">{view.length} activities</p>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {view.map((a) => (
          <li key={a.id} className="px-3 py-2">
            <button onClick={() => setOpenId(openId === a.id ? null : a.id)} className="flex w-full items-start justify-between gap-3 text-left">
              <span>
                <span className="mr-2 text-xs text-slate-400">{a.wbsCode}</span>
                <span className={a.isCritical ? "font-medium text-red-700" : "font-medium"}>{a.name}</span>
                {a.type === "milestone" && <span className="ml-2 text-xs text-indigo-600">◆ milestone</span>}
              </span>
              <span className="whitespace-nowrap text-xs text-slate-500">
                {fmtDate(a.plannedStart)} → {fmtDate(a.plannedFinish)}
              </span>
            </button>
            {openId === a.id && (
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                <div>ID: {a.externalId ?? "—"}</div>
                <div>% complete: {a.percentComplete ?? "—"}</div>
                <div>Duration (days): {a.durationDays?.toFixed(2) ?? "—"}</div>
                <div>Total float (days): {a.totalSlackDays?.toFixed(2) ?? "—"}</div>
                {Object.entries(a.customFields).map(([k, v]) => (
                  <div key={k}>{k}: {v}</div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
