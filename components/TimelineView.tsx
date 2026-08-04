"use client";

import type { ScheduleRow } from "@/lib/schedule/types";
import { spanPct, pointPct, axisTicks, weekendBands, gridLines, type TimelineWindow } from "@/lib/schedule/timelineGeometry";
import { paletteEntry } from "./sectionPalette";
import { ActivityDetail } from "./ActivityDetail";

export interface TimelineItem {
  row: ScheduleRow;
  paletteIndex: number;
  descendantCount: number;
  sectionName: string | null;
}

const LEFT_COL = "38%";

function fmtDur(days: number): string {
  return Number.isInteger(days) ? `${days}d` : `${days.toFixed(1)}d`;
}

export function TimelineView({
  items,
  window: win,
  todayIso,
  openId,
  onToggleOpen,
  collapsed,
  onToggleCollapsed,
}: {
  items: TimelineItem[];
  window: TimelineWindow;
  todayIso: string;
  openId: string | null;
  onToggleOpen(id: string): void;
  collapsed: Set<string>;
  onToggleCollapsed(id: string): void;
}) {
  const ticks = axisTicks(win);
  const bands = weekendBands(win);
  const grid = gridLines(win);
  const todayPct = pointPct(todayIso, win);

  return (
    <div className="relative overflow-hidden rounded border border-slate-200 bg-white">
      {/* Time layers: weekend bands + today line span the bar area of every row. */}
      <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: LEFT_COL }}>
        {bands.map((b, i) => (
          <div key={i} className="absolute inset-y-0 bg-slate-100/70" style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }} />
        ))}
        {grid.map((g, i) => (
          <div
            key={`g${i}`}
            data-grid={g.isMajor ? "major" : "day"}
            className={`absolute inset-y-0 w-px ${g.isMajor ? "bg-slate-300" : "bg-slate-200/80"}`}
            style={{ left: `${g.leftPct}%` }}
          />
        ))}
        {todayPct !== null && (
          <div className="absolute inset-y-0 z-10 w-px bg-cyan-600" style={{ left: `${todayPct}%` }} />
        )}
      </div>

      {/* Axis header */}
      <div className="relative flex border-b-2 border-slate-200 text-[10px] text-slate-500">
        <div className="shrink-0 px-3 py-1 font-medium" style={{ width: LEFT_COL }}>Activity</div>
        <div className="relative h-6 flex-1">
          {ticks.map((t) => (
            <span key={t.label + t.leftPct} className="absolute top-1 -translate-x-1/2 whitespace-nowrap" style={{ left: `${t.leftPct}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-slate-100">
        {items.map(({ row: a, paletteIndex, descendantCount, sectionName }) => {
          if (a.type === "summary") {
            const palette = paletteEntry(paletteIndex);
            const isCollapsed = collapsed.has(a.id);
            return (
              <li key={a.id} className={`relative ${a.outlineLevel === 1 ? palette.bg : palette.nestedBg}`}>
                <button
                  onClick={() => onToggleCollapsed(a.id)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm font-semibold ${palette.text}`}
                  style={{ paddingLeft: 10 + (a.outlineLevel - 1) * 12 }}
                >
                  <span>
                    {isCollapsed ? "▸" : "▾"} <span className="mr-2 text-xs font-normal opacity-70">{a.wbsCode}</span>
                    <span>{a.name}</span>
                  </span>
                  <span className="whitespace-nowrap text-xs font-normal opacity-70">
                    {descendantCount} activities{isCollapsed ? " (collapsed)" : ""}
                  </span>
                </button>
              </li>
            );
          }

          const palette = paletteEntry(paletteIndex);
          const isMilestone = a.type === "milestone";
          const planned = isMilestone ? null : spanPct(a.plannedStart, a.plannedFinish, win);
          const expected = isMilestone ? null : spanPct(a.expectedStart ?? a.plannedStart, a.expectedFinish ?? a.plannedFinish, win);
          const plannedPoint = isMilestone ? pointPct(a.plannedFinish ?? a.plannedStart, win) : null;
          const expectedPoint = isMilestone ? pointPct(a.expectedFinish ?? a.expectedStart ?? a.plannedFinish, win) : null;
          const pct = Math.min(100, Math.max(0, a.percentComplete ?? 0));

          return (
            <li key={a.id} className="relative">
              <div className="flex items-stretch">
                <button
                  onClick={() => onToggleOpen(a.id)}
                  className={`shrink-0 border-l-4 px-3 py-1.5 text-left text-sm ${palette.rail}`}
                  style={{ width: LEFT_COL, paddingLeft: 10 + (a.outlineLevel - 1) * 12 }}
                >
                  <span className="mr-2 text-xs text-slate-400">{a.wbsCode}</span>
                  <span className={a.isCritical ? "font-medium text-red-700" : "font-medium"}>{a.canonicalScope ?? a.name}</span>
                  {a.canonicalScope && a.canonicalScope !== a.name && (
                    <span className="ml-2 text-xs text-slate-400">{a.name}</span>
                  )}
                  {!isMilestone && a.durationDays !== null && (
                    <span className="ml-2 whitespace-nowrap text-xs text-slate-400">{fmtDur(a.durationDays)}</span>
                  )}
                  {isMilestone && <span className="ml-2 text-xs text-indigo-600">◆</span>}
                  {a.percentComplete === 100 && (
                    <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">✓ Completed</span>
                  )}
                  {a.atRisk && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">AT RISK</span>
                  )}
                </button>
                <div className="relative min-h-[2.25rem] flex-1">
                  {planned && (
                    <div
                      data-bar="planned"
                      className="absolute top-2 h-1.5 rounded-sm bg-slate-300"
                      style={{ left: `${planned.leftPct}%`, width: `${planned.widthPct}%` }}
                    />
                  )}
                  {expected && (
                    <div
                      data-bar="expected"
                      className="absolute top-4 h-2.5 overflow-hidden rounded-sm bg-cyan-600/70"
                      style={{ left: `${expected.leftPct}%`, width: `${expected.widthPct}%` }}
                    >
                      <div className="h-full bg-cyan-800" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {expected && a.driftDays > 0 && (
                    <span
                      className="absolute top-3.5 ml-1 text-[10px] font-bold text-red-600"
                      style={{ left: `${Math.min(expected.leftPct + expected.widthPct, 97)}%` }}
                    >
                      +{a.driftDays}d
                    </span>
                  )}
                  {plannedPoint !== null && (
                    <span data-milestone="planned" className="absolute top-2 -translate-x-1/2 text-xs text-slate-400" style={{ left: `${plannedPoint}%` }}>◇</span>
                  )}
                  {expectedPoint !== null && (
                    <span data-milestone="expected" className="absolute top-2 -translate-x-1/2 text-xs text-indigo-600" style={{ left: `${expectedPoint}%` }}>◆</span>
                  )}
                </div>
              </div>
              {openId === a.id && (
                <div className="px-3 pb-2" style={{ paddingLeft: 14 + (a.outlineLevel - 1) * 12 }}>
                  <ActivityDetail row={a} sectionName={sectionName} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
