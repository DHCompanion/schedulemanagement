"use client";

import type { ReactNode } from "react";
import type { ScheduleRow } from "@/lib/schedule/types";
import { describeProcurement, describeAtRiskCause } from "@/lib/procurement/display";
import { fmtShortDate } from "@/lib/schedule/weekBuckets";

function range(startIso: string | null, endIso: string | null): string {
  const s = startIso ? fmtShortDate(startIso) : "—";
  const e = endIso ? fmtShortDate(endIso) : "—";
  return `${s} → ${e}`;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</dt>
      <dd className="mt-0.5 space-y-0.5">{children}</dd>
    </div>
  );
}

/** The row detail panel shared by the timeline and bucket views (spec §3). */
export function ActivityDetail({ row, sectionName }: { row: ScheduleRow; sectionName?: string | null }) {
  const procurement = row.procurement ? describeProcurement(row.procurement) : null;
  const procurementBehind = (row.procurement?.behindCount ?? 0) > 0;
  const progress = [
    row.percentComplete !== null && `${row.percentComplete}% complete`,
    row.totalSlackDays !== null && `${row.totalSlackDays.toFixed(2)}d total float`,
  ].filter(Boolean);
  const fileFields: [string, string | number][] = [
    ...(row.externalId !== null ? [["ID", row.externalId] as [string, number]] : []),
    ...Object.entries(row.customFields),
  ];

  // Opaque and stacked above the timeline's gridlines: in the timeline this card
  // sits in a row that spans the Gantt, so a transparent panel reads as text
  // with lines drawn through it.
  return (
    <div className="relative z-10 mt-2 max-w-2xl space-y-2 rounded border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-sm">
      {row.atRisk && row.atRiskItem && (
        <div className="rounded bg-amber-50 px-2 py-1 font-medium text-amber-800">
          At risk: {describeAtRiskCause(row.atRiskItem, fmtShortDate)}
        </div>
      )}
      {row.pushedByName && (
        <div className="rounded bg-amber-50 px-2 py-1 text-amber-800">
          Pushed by {row.pushedByName} (+{row.driftDays}d)
        </div>
      )}
      {/* auto-fit, not breakpoints: the bucket view's cards are narrow on a wide screen. */}
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-x-6 gap-y-2">
        <Group title="Schedule">
          <div className="text-slate-500">Planned: {range(row.plannedStart, row.plannedFinish)}</div>
          <div>
            Expected: {range(row.expectedStart, row.expectedFinish)}
            {row.driftDays > 0 && <span className="ml-1 font-semibold text-red-600">+{row.driftDays}d</span>}
          </div>
          {progress.length > 0 && <div className="text-slate-500">{progress.join(" · ")}</div>}
        </Group>
        {(row.disciplineName || row.partnerName) && (
          <Group title="Trade">
            {row.disciplineName && <div>{row.disciplineName}</div>}
            {row.partnerName && <div className="text-slate-500">{row.partnerName}</div>}
          </Group>
        )}
        {procurement && (
          <Group title="This trade's procurement">
            <div className={procurementBehind ? "font-medium text-amber-800" : undefined}>{procurement.headline}</div>
            {procurement.details.map((d) => (
              <div key={d} className="text-slate-500">{d}</div>
            ))}
          </Group>
        )}
      </dl>
      {(sectionName || fileFields.length > 0) && (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-1 border-t border-slate-100 pt-2 text-slate-500">
          {sectionName && <span>Section: {sectionName}</span>}
          {fileFields.length > 0 && (
            <details>
              <summary className="cursor-pointer select-none">From the file</summary>
              <div className="mt-1 space-y-0.5">
                {fileFields.map(([k, v]) => (
                  <div key={k}>{k}: {v}</div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
