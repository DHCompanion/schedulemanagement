"use client";

import type { ScheduleRow } from "@/lib/schedule/types";
import { describeProcurement } from "@/lib/procurement/display";
import { fmtShortDate } from "@/lib/schedule/weekBuckets";

function range(startIso: string | null, endIso: string | null): string {
  const s = startIso ? fmtShortDate(startIso) : "—";
  const e = endIso ? fmtShortDate(endIso) : "—";
  return `${s} → ${e}`;
}

/** The row detail panel shared by the timeline and bucket views (spec §3). */
export function ActivityDetail({ row, sectionName }: { row: ScheduleRow; sectionName?: string | null }) {
  return (
    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
      <div className="col-span-2 flex flex-wrap gap-x-4">
        <span>Planned: {range(row.plannedStart, row.plannedFinish)}</span>
        <span>
          Expected: {range(row.expectedStart, row.expectedFinish)}
          {row.driftDays > 0 && <span className="ml-1 font-semibold text-red-600">+{row.driftDays}d</span>}
        </span>
      </div>
      {row.pushedByName && (
        <div className="col-span-2 text-amber-800">
          Pushed by {row.pushedByName} (+{row.driftDays}d)
        </div>
      )}
      <div>ID: {row.externalId ?? "—"}</div>
      <div>% complete: {row.percentComplete ?? "—"}</div>
      <div>Duration (days): {row.durationDays?.toFixed(2) ?? "—"}</div>
      <div>Total float (days): {row.totalSlackDays?.toFixed(2) ?? "—"}</div>
      {row.disciplineName && <div>Discipline: {row.disciplineName}</div>}
      {row.partnerName && <div>Trade partner: {row.partnerName}</div>}
      {sectionName && <div className="col-span-2">Section: {sectionName}</div>}
      {row.procurement && (() => {
        const { headline, details } = describeProcurement(row.procurement);
        return (
          <div className="col-span-2">
            <div>This trade&apos;s procurement: {headline}</div>
            {details.map((d) => (
              <div key={d} className="pl-3 text-slate-500">{d}</div>
            ))}
          </div>
        );
      })()}
      {Object.entries(row.customFields).map(([k, v]) => (
        <div key={k}>{k}: {v}</div>
      ))}
    </dl>
  );
}
