"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ScheduleRow } from "@/lib/schedule/types";
import { deriveSectionInfo, isHiddenByCollapse, assignSiblingIndices } from "@/lib/schedule/wbsGrouping";
import { resolveWindow, type ViewKey } from "@/lib/schedule/timelineGeometry";
import { TimelineView, type TimelineItem } from "./TimelineView";
import { BucketView, type BucketRow } from "./BucketView";

type Filter = "all" | "milestones" | "critical" | "in_progress" | "not_completed" | "at_risk";
type Sort = "wbs" | "start" | "slack" | "drift";

const FILTERS: Filter[] = ["all", "milestones", "critical", "in_progress", "not_completed", "at_risk"];
const SORTS: Sort[] = ["wbs", "start", "slack", "drift"];
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "full", label: "Full" },
  { key: "6wk", label: "6 wk" },
  { key: "3wk", label: "3 wk" },
];

function leafMatches(a: ScheduleRow, q: string, filter: Filter, discipline: string): boolean {
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
  if (filter === "at_risk" && !a.atRisk) return false;
  if (discipline !== "all" && a.disciplineName !== discipline) return false;
  return true;
}

function useIsDesktop(): boolean {
  // SSR renders desktop; phones correct on hydration (spec: mobile = buckets).
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return isDesktop;
}

export function ScheduleBody({
  rows,
  projectId,
  statusDate,
  view,
  initialFilter,
  initialSort,
}: {
  rows: ScheduleRow[];
  projectId: string;
  statusDate: string;
  view: ViewKey;
  initialFilter: string | null;
  initialSort: string | null;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(FILTERS.includes(initialFilter as Filter) ? (initialFilter as Filter) : "all");
  const [discipline, setDiscipline] = useState("all");
  const [sort, setSort] = useState<Sort>(SORTS.includes(initialSort as Sort) ? (initialSort as Sort) : "wbs");
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const isDesktop = useIsDesktop();

  const grouped = sort === "wbs";

  const disciplines = useMemo(
    () => [...new Set(rows.map((r) => r.disciplineName).filter((d): d is string => Boolean(d)))].sort(),
    [rows],
  );

  const window = useMemo(() => {
    const dates = rows.flatMap((r) => [r.plannedStart, r.plannedFinish, r.expectedStart, r.expectedFinish]);
    return resolveWindow(view, dates, new Date(statusDate));
  }, [rows, view, statusDate]);

  // In windowed views only work touching the window (or active work) shows.
  const inWindow = useMemo(() => {
    if (view === "full") return () => true;
    return (a: ScheduleRow) => {
      if (a.status === "in_progress") return true;
      const s = Date.parse(a.expectedStart ?? a.plannedStart ?? "");
      const e = Date.parse(a.expectedFinish ?? a.plannedFinish ?? "");
      if (Number.isNaN(s) && Number.isNaN(e)) return false;
      const from = Number.isNaN(s) ? e : s;
      const to = Number.isNaN(e) ? s : e;
      return to >= window.startMs && from <= window.endMs;
    };
  }, [view, window]);

  const sortedRows = useMemo(() => {
    const r = [...rows];
    if (sort === "wbs") r.sort((a, b) => (a.wbsCode ?? "").localeCompare(b.wbsCode ?? "", undefined, { numeric: true }));
    if (sort === "start") r.sort((a, b) => (a.expectedStart ?? a.plannedStart ?? "").localeCompare(b.expectedStart ?? b.plannedStart ?? ""));
    if (sort === "slack") r.sort((a, b) => (a.totalSlackDays ?? Infinity) - (b.totalSlackDays ?? Infinity));
    if (sort === "drift") r.sort((a, b) => b.driftDays - a.driftDays);
    return r;
  }, [rows, sort]);

  // Grouped outline pipeline (ported from the retired outline table), extended
  // with the nearest-section name/palette each leaf carries for rails and cards.
  const { items, leafCount } = useMemo(() => {
    const candidates = sortedRows.filter((a) => a.type !== "project_summary");
    const info = deriveSectionInfo(candidates.map((a) => ({ id: a.id, outlineLevel: a.outlineLevel })));
    const byId = new Map(candidates.map((a) => [a.id, a]));
    const matchedLeafIds = new Set(
      candidates
        .filter((a) => a.type !== "summary" && leafMatches(a, q, filter, discipline) && inWindow(a))
        .map((a) => a.id),
    );

    if (!grouped) {
      const flat: TimelineItem[] = [];
      for (const a of sortedRows) {
        if (a.type === "summary" || a.type === "project_summary" || !matchedLeafIds.has(a.id)) continue;
        const summaryAncestor = [...(info.get(a.id)?.ancestorIds ?? [])].reverse().find((id) => byId.get(id)?.type === "summary");
        flat.push({ row: a, paletteIndex: 0, descendantCount: 0, sectionName: summaryAncestor ? byId.get(summaryAncestor)!.name : null });
      }
      return { items: flat, leafCount: flat.length };
    }

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

    const result: TimelineItem[] = [];
    for (const a of candidates) {
      const isLeaf = a.type !== "summary";
      const included = isLeaf ? matchedLeafIds.has(a.id) : hasVisibleDescendant.has(a.id);
      if (!included) continue;
      const rowInfo = info.get(a.id)!;
      if (isHiddenByCollapse(rowInfo.ancestorIds, collapsed)) continue;
      const summaryAncestorId = [...rowInfo.ancestorIds].reverse().find((id) => byId.get(id)?.type === "summary") ?? null;
      result.push({
        row: a,
        paletteIndex: isLeaf
          ? (summaryAncestorId ? siblingIndex.get(summaryAncestorId) ?? 0 : 0)
          : siblingIndex.get(a.id) ?? 0,
        descendantCount: descendantCounts.get(a.id) ?? 0,
        sectionName: summaryAncestorId ? byId.get(summaryAncestorId)!.name : null,
      });
    }
    return { items: result, leafCount: matchedLeafIds.size };
  }, [grouped, sortedRows, q, filter, discipline, collapsed, inWindow]);

  const bucketRows: BucketRow[] = useMemo(
    () =>
      items
        .filter((i) => i.row.type !== "summary")
        .map((i) => ({ ...i.row, paletteIndex: i.paletteIndex, sectionName: i.sectionName })),
    [items],
  );

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
          <option value="at_risk">At risk</option>
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
          <option value="drift">Sort: Drift</option>
        </select>
        {isDesktop && (
          <span className="ml-auto flex overflow-hidden rounded border border-slate-300 text-sm">
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={`/projects/${projectId}?view=${v.key}`}
                className={`px-3 py-2 ${view === v.key ? "bg-cyan-700 font-medium text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {v.label}
              </Link>
            ))}
          </span>
        )}
      </div>
      <p className="mb-2 text-xs text-slate-500">Showing {leafCount} activities</p>
      {isDesktop ? (
        <TimelineView
          items={items}
          window={window}
          todayIso={statusDate}
          openId={openId}
          onToggleOpen={(id) => setOpenId(openId === id ? null : id)}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      ) : (
        <BucketView
          rows={bucketRows}
          asOfIso={statusDate}
          openId={openId}
          onToggleOpen={(id) => setOpenId(openId === id ? null : id)}
        />
      )}
    </div>
  );
}
