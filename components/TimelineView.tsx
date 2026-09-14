"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ScheduleRow } from "@/lib/schedule/types";
import { spanPct, pointPct, axisTicks, weekendBands, gridLines, type TimelineWindow } from "@/lib/schedule/timelineGeometry";
import { fmtShortDate } from "@/lib/schedule/weekBuckets";
import { isRequiredOnSiteOutOfSync } from "@/lib/schedule/requiredOnSiteSync";
import { connectorPath } from "@/lib/schedule/pushLinks";
import { paletteEntry } from "./sectionPalette";
import { ActivityDetail } from "./ActivityDetail";

export interface TimelineItem {
  row: ScheduleRow;
  paletteIndex: number;
  descendantCount: number;
  sectionName: string | null;
}

const LEFT_COL = "48%";
// Two fixed date columns live inside the left region (name flexes to fill the rest).
const DATE_CELL = "w-[74px] shrink-0 px-1 text-right text-xs tabular-nums";

function fmtDate(iso: string | null): string {
  return iso ? fmtShortDate(iso) : "—";
}

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

  // On-demand push connectors: clicking an activity's "pushed by" or "pushing N"
  // chip selects it and draws the link(s) to its driver / the successors it pushes,
  // highlighting the counterpart rows. Nothing is drawn until a chip is clicked.
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<Map<number, HTMLElement>>(new Map());
  const [links, setLinks] = useState<{ key: string; d: string }[]>([]);

  const rowByUid = new Map(items.filter((i) => i.row.type !== "summary").map((i) => [i.row.externalUid, i.row]));

  const highlightUids = new Set<number>();
  if (selectedUid !== null) {
    highlightUids.add(selectedUid);
    const sel = rowByUid.get(selectedUid);
    if (sel?.pushedByUid != null) highlightUids.add(sel.pushedByUid);
    for (const i of items) if (i.row.type !== "summary" && i.row.pushedByUid === selectedUid) highlightUids.add(i.row.externalUid);
  }

  const toggleSelected = (uid: number) => setSelectedUid((cur) => (cur === uid ? null : uid));

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const container = containerRef.current;
    if (selectedUid === null || !overlay || !container) { setLinks([]); return; }
    const sel = rowByUid.get(selectedUid);
    if (!sel) { setLinks([]); return; }
    const svgW = overlay.clientWidth;
    const cTop = container.getBoundingClientRect().top;
    const centerY = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 - cTop; };

    // pairs oriented [driver, pushed]: the selected item's incoming push, plus any it drives.
    const pairs: [ScheduleRow, ScheduleRow][] = [];
    if (sel.pushedByUid != null) { const drv = rowByUid.get(sel.pushedByUid); if (drv) pairs.push([drv, sel]); }
    for (const i of items) if (i.row.type !== "summary" && i.row.pushedByUid === selectedUid) pairs.push([sel, i.row]);

    const out: { key: string; d: string }[] = [];
    for (const [drv, psh] of pairs) {
      const drvBar = barRefs.current.get(drv.externalUid);
      const pshBar = barRefs.current.get(psh.externalUid);
      if (!drvBar || !pshBar) continue; // a counterpart hidden by collapse/filter — skip
      const drvSpan = spanPct(drv.expectedStart ?? drv.plannedStart, drv.expectedFinish ?? drv.plannedFinish, win);
      const pshSpan = spanPct(psh.expectedStart ?? psh.plannedStart, psh.expectedFinish ?? psh.plannedFinish, win);
      if (!drvSpan || !pshSpan) continue; // outside the current window
      const fromX = ((drvSpan.leftPct + drvSpan.widthPct) / 100) * svgW;
      const toX = (pshSpan.leftPct / 100) * svgW;
      out.push({ key: `${drv.externalUid}->${psh.externalUid}`, d: connectorPath({ x: fromX, y: centerY(drvBar) }, { x: toX, y: centerY(pshBar) }) });
    }
    setLinks(out);
  }, [selectedUid, items, win]);

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded border border-slate-200 bg-white">
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

      {/* Push-link connectors (on-demand): spans the bar area, drawn only when a chip is selected. */}
      <div ref={overlayRef} className="pointer-events-none absolute inset-y-0 right-0 z-20" style={{ left: LEFT_COL }}>
        {links.length > 0 && (
          <svg className="h-full w-full overflow-visible" fill="none">
            <defs>
              <marker id="pushArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#d97706" />
              </marker>
            </defs>
            {links.map((l) => (
              <path key={l.key} d={l.d} stroke="#d97706" strokeWidth={2} markerEnd="url(#pushArrow)" />
            ))}
          </svg>
        )}
      </div>

      {/* Axis header */}
      <div className="relative flex border-b-2 border-slate-200 text-[10px] text-slate-500">
        <div className="flex shrink-0 items-center py-1 font-medium" style={{ width: LEFT_COL }}>
          <span className="flex-1 px-3">Activity</span>
          <span className={DATE_CELL}>Start</span>
          <span className={DATE_CELL}>Finish</span>
        </div>
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

          // Forecast dates for the Start/Finish columns (fall back to planned).
          // A milestone is a single point — show its date under Finish only.
          const rowStart = isMilestone ? null : (a.expectedStart ?? a.plannedStart);
          const rowFinish = isMilestone
            ? (a.expectedFinish ?? a.expectedStart ?? a.plannedFinish)
            : (a.expectedFinish ?? a.plannedFinish);
          const rosDate = a.atRiskItem?.requiredOnSite ?? null;
          const rosAnchor = isMilestone ? rowFinish : rowStart;
          const rosOutOfSync = isRequiredOnSiteOutOfSync(rosDate, rosAnchor);
          const rosWarning = rosOutOfSync ? (
            <span
              className="mr-0.5 cursor-help text-amber-600"
              title={`Required on site ${fmtDate(rosDate)} is on/after this activity's start ${fmtDate(rosAnchor)} — likely a stale procurement link.`}
            >
              ⚠
            </span>
          ) : null;

          return (
            <li key={a.id} className={`relative ${highlightUids.has(a.externalUid) ? "bg-amber-50 ring-1 ring-inset ring-amber-300" : ""}`}>
              <div className="flex items-stretch">
                <div className="flex shrink-0 items-stretch" style={{ width: LEFT_COL }}>
                  <button
                    onClick={() => onToggleOpen(a.id)}
                    className={`min-w-0 flex-1 border-l-4 px-3 py-1.5 text-left text-sm ${palette.rail}`}
                    style={{ paddingLeft: 10 + (a.outlineLevel - 1) * 12 }}
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
                  <span className={`${DATE_CELL} flex items-center justify-end py-1.5 text-slate-500`}>
                    {isMilestone ? null : rosWarning}
                    {fmtDate(rowStart)}
                  </span>
                  <span className={`${DATE_CELL} flex items-center justify-end py-1.5 text-slate-500`}>
                    {isMilestone ? rosWarning : null}
                    {fmtDate(rowFinish)}
                  </span>
                </div>
                <div
                  ref={(el) => { if (el) barRefs.current.set(a.externalUid, el); else barRefs.current.delete(a.externalUid); }}
                  className="relative min-h-[2.25rem] flex-1"
                >
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
              {((a.pushedByName && a.driftDays > 0) || a.pushesCount > 0) && (
                <div className="flex flex-wrap items-center gap-2 pb-1 text-[11px]" style={{ paddingLeft: 14 + (a.outlineLevel - 1) * 12 }}>
                  {a.pushedByName && a.driftDays > 0 && (
                    <button
                      onClick={() => toggleSelected(a.externalUid)}
                      className={`rounded px-1.5 py-0.5 font-medium ${selectedUid === a.externalUid ? "bg-amber-200 text-amber-900" : "bg-amber-50 text-amber-700 hover:bg-amber-100"}`}
                      title={`Delayed completion of "${a.pushedByName}" pushed this activity +${a.driftDays} working days. Click to trace the link.`}
                    >
                      ⤶ pushed by {a.pushedByName} +{a.driftDays}d
                    </button>
                  )}
                  {a.pushesCount > 0 && (
                    <button
                      onClick={() => toggleSelected(a.externalUid)}
                      className={`rounded px-1.5 py-0.5 font-medium ${selectedUid === a.externalUid ? "bg-amber-200 text-amber-900" : "bg-amber-50 text-amber-700 hover:bg-amber-100"}`}
                      title={`This activity's slip is pushing ${a.pushesCount} later ${a.pushesCount === 1 ? "activity" : "activities"}. Click to trace the links.`}
                    >
                      ⤳ pushing {a.pushesCount}
                    </button>
                  )}
                </div>
              )}
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
