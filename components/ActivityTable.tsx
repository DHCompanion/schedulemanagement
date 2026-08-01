"use client";

import { useMemo, useState } from "react";
import { deriveSectionInfo, isHiddenByCollapse, assignSiblingIndices } from "@/lib/schedule/wbsGrouping";
import { describeProcurement, type ActivityProcurement } from "@/lib/trades/activityTrades";

export interface ActivityRow {
  id: string;
  externalId: number | null;
  wbsCode: string | null;
  name: string;
  /** The standard name confirmed in Task Naming, when this activity has one. */
  canonicalScope: string | null;
  /** Derived from the scope dictionary and this project's trade assignments. */
  disciplineName: string | null;
  partnerName: string | null;
  /** Procurement flagged this activity's trade partner. Resolved server-side. */
  atRisk: boolean;
  /** Procurement tallies for this activity's trade partner, null when unknown. */
  procurement: ActivityProcurement | null;
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

type Filter = "all" | "milestones" | "critical" | "in_progress" | "not_completed";
type Sort = "wbs" | "start" | "slack";

interface RenderItem {
  row: ActivityRow;
  paletteIndex: number;
  descendantCount: number;
}

const SECTION_PALETTE = [
  { bg: "bg-indigo-100", nestedBg: "bg-indigo-50", text: "text-indigo-900" },
  { bg: "bg-amber-100", nestedBg: "bg-amber-50", text: "text-amber-900" },
  { bg: "bg-emerald-100", nestedBg: "bg-emerald-50", text: "text-emerald-900" },
  { bg: "bg-rose-100", nestedBg: "bg-rose-50", text: "text-rose-900" },
  { bg: "bg-sky-100", nestedBg: "bg-sky-50", text: "text-sky-900" },
  { bg: "bg-violet-100", nestedBg: "bg-violet-50", text: "text-violet-900" },
];

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return s.slice(0, 10);
}

function leafMatches(a: ActivityRow, q: string, filter: Filter, discipline: string): boolean {
  if (q.trim()) {
    const needle = q.trim().toLowerCase();
    const hit =
      a.name.toLowerCase().includes(needle) ||
      (a.canonicalScope ?? "").toLowerCase().includes(needle) ||
      (a.disciplineName ?? "").toLowerCase().includes(needle) ||
      (a.partnerName ?? "").toLowerCase().includes(needle) ||
      (a.wbsCode ?? "").includes(needle) ||
      String(a.externalId ?? "").includes(needle);
    if (!hit) return false;
  }
  if (filter === "milestones" && a.type !== "milestone") return false;
  if (filter === "critical" && !a.isCritical) return false;
  if (filter === "in_progress" && !((a.percentComplete ?? 0) > 0 && (a.percentComplete ?? 0) < 100)) return false;
  if (filter === "not_completed" && a.percentComplete === 100) return false;
  if (discipline !== "all" && a.disciplineName !== discipline) return false;
  return true;
}

export function ActivityTable({ rows }: { rows: ActivityRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [discipline, setDiscipline] = useState("all");
  const [sort, setSort] = useState<Sort>("wbs");
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const sortedRows = useMemo(() => {
    const r = [...rows];
    if (sort === "wbs") r.sort((a, b) => (a.wbsCode ?? "").localeCompare(b.wbsCode ?? "", undefined, { numeric: true }));
    if (sort === "start") r.sort((a, b) => (a.plannedStart ?? "").localeCompare(b.plannedStart ?? ""));
    if (sort === "slack") r.sort((a, b) => (a.totalSlackDays ?? Infinity) - (b.totalSlackDays ?? Infinity));
    return r;
  }, [rows, sort]);

  const grouped = sort === "wbs";

  const disciplines = useMemo(
    () => [...new Set(rows.map((r) => r.disciplineName).filter((d): d is string => Boolean(d)))].sort(),
    [rows],
  );

  const flatView = useMemo(
    () => sortedRows.filter((a) => leafMatches(a, q, filter, discipline)),
    [sortedRows, q, filter, discipline],
  );

  const { items, leafCount } = useMemo(() => {
    if (!grouped) return { items: [] as RenderItem[], leafCount: 0 };

    const candidates = sortedRows.filter((a) => a.type !== "project_summary");
    const info = deriveSectionInfo(candidates.map((a) => ({ id: a.id, outlineLevel: a.outlineLevel })));
    const matchedLeafIds = new Set(
      candidates.filter((a) => a.type !== "summary" && leafMatches(a, q, filter, discipline)).map((a) => a.id),
    );
    const hasVisibleDescendant = new Set<string>();
    const descendantCounts = new Map<string, number>();
    for (const a of candidates) {
      if (!matchedLeafIds.has(a.id)) continue;
      for (const ancestorId of info.get(a.id)?.ancestorIds ?? []) {
        hasVisibleDescendant.add(ancestorId);
        descendantCounts.set(ancestorId, (descendantCounts.get(ancestorId) ?? 0) + 1);
      }
    }

    const visibleSections = candidates.filter((a) => a.type === "summary" && hasVisibleDescendant.has(a.id));
    const siblingIndex = assignSiblingIndices(visibleSections, info);

    const result: RenderItem[] = [];
    for (const a of candidates) {
      const isLeaf = a.type !== "summary";
      const included = isLeaf ? matchedLeafIds.has(a.id) : hasVisibleDescendant.has(a.id);
      if (!included) continue;
      const rowInfo = info.get(a.id)!;
      if (isHiddenByCollapse(rowInfo.ancestorIds, collapsed)) continue;
      result.push({
        row: a,
        paletteIndex: siblingIndex.get(a.id) ?? 0,
        descendantCount: descendantCounts.get(a.id) ?? 0,
      });
    }
    return { items: result, leafCount: matchedLeafIds.size };
  }, [grouped, sortedRows, q, filter, discipline, collapsed]);

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderLeafRow(a: ActivityRow, paddingLeft?: number) {
    return (
      <li key={a.id} className="px-3 py-2" style={paddingLeft ? { paddingLeft } : undefined}>
        <button onClick={() => setOpenId(openId === a.id ? null : a.id)} className="flex w-full items-start justify-between gap-3 text-left">
          <span>
            <span className="mr-2 text-xs text-slate-400">{a.wbsCode}</span>
            <span className={a.isCritical ? "font-medium text-red-700" : "font-medium"}>{a.canonicalScope ?? a.name}</span>
            {a.canonicalScope && a.canonicalScope !== a.name && (
              <span className="ml-2 text-xs text-slate-400">{a.name}</span>
            )}
            {a.type === "milestone" && <span className="ml-2 text-xs text-indigo-600">◆ milestone</span>}
            {a.percentComplete === 100 && (
              <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">✓ Completed</span>
            )}
            {a.atRisk && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                AT RISK
              </span>
            )}
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
            {a.disciplineName && <div>Discipline: {a.disciplineName}</div>}
            {a.partnerName && <div>Trade partner: {a.partnerName}</div>}
            {(() => {
              if (!a.procurement) return null;
              const { headline, details } = describeProcurement(a.procurement);
              return (
                <div className="col-span-2">
                  <div>This trade&apos;s procurement: {headline}</div>
                  {details.map((d) => (
                    <div key={d} className="pl-3 text-slate-500">{d}</div>
                  ))}
                </div>
              );
            })()}
            {Object.entries(a.customFields).map(([k, v]) => (
              <div key={k}>{k}: {v}</div>
            ))}
          </dl>
        )}
      </li>
    );
  }

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
          <option value="not_completed">Not completed</option>
        </select>
        {disciplines.length > 0 && (
          <select value={discipline} onChange={(e) => setDiscipline(e.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm">
            <option value="all">All trades</option>
            {disciplines.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded border border-slate-300 px-2 py-2 text-sm">
          <option value="wbs">Sort: WBS</option>
          <option value="start">Sort: Start</option>
          <option value="slack">Sort: Float</option>
        </select>
      </div>
      <p className="mb-2 text-xs text-slate-500">{grouped ? leafCount : flatView.length} activities</p>
      <ul className="divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {grouped
          ? items.map(({ row: a, paletteIndex, descendantCount }) => {
              if (a.type === "summary") {
                const palette = SECTION_PALETTE[paletteIndex % SECTION_PALETTE.length];
                const isTopSection = a.outlineLevel === 1;
                const isCollapsed = collapsed.has(a.id);
                return (
                  <li key={a.id} className={isTopSection ? palette.bg : palette.nestedBg}>
                    <button
                      onClick={() => toggleCollapsed(a.id)}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left font-semibold ${palette.text}`}
                      style={{ paddingLeft: 10 + (a.outlineLevel - 1) * 12 }}
                    >
                      <span>
                        {isCollapsed ? "▸" : "▾"} <span className="mr-2 text-xs font-normal opacity-70">{a.wbsCode}</span>
                        {a.name}
                      </span>
                      <span className="whitespace-nowrap text-xs font-normal opacity-70">
                        {descendantCount} activities{isCollapsed ? " (collapsed)" : ""}
                      </span>
                    </button>
                  </li>
                );
              }
              return renderLeafRow(a, 10 + (a.outlineLevel - 1) * 12);
            })
          : flatView.map((a) => renderLeafRow(a))}
      </ul>
    </div>
  );
}
