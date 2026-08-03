"use client";

import type { ScheduleRow } from "@/lib/schedule/types";
import { groupIntoBuckets, bucketLabel, fmtShortDate, BUCKET_ORDER, type BucketKey } from "@/lib/schedule/weekBuckets";
import { paletteEntry } from "./sectionPalette";
import { ActivityDetail } from "./ActivityDetail";

export interface BucketRow extends ScheduleRow {
  paletteIndex: number;
  sectionName: string | null;
}

// Card status edge (spec §3): red = its own slip, amber = pushed by a
// predecessor, green = on plan.
function edgeClass(row: ScheduleRow): string {
  if (row.driftDays > 0 && !row.pushedByName) return "border-l-red-600";
  if (row.driftDays > 0) return "border-l-amber-500";
  return "border-l-emerald-500";
}

function driftWords(row: ScheduleRow): string | null {
  if (row.driftDays <= 0) return null;
  if (row.status === "not_started" && row.plannedStart && row.expectedStart) {
    return `was ${fmtShortDate(row.plannedStart)} → now ${fmtShortDate(row.expectedStart)}`;
  }
  if (row.plannedFinish && row.expectedFinish) {
    return `was ${fmtShortDate(row.plannedFinish)} → now ${fmtShortDate(row.expectedFinish)}`;
  }
  return `+${row.driftDays}d`;
}

function Card({ row, openId, onToggleOpen }: { row: BucketRow; openId: string | null; onToggleOpen(id: string): void }) {
  const words = driftWords(row);
  return (
    <div className={`mb-2 rounded border border-slate-200 border-l-4 bg-white ${edgeClass(row)}`}>
      <button onClick={() => onToggleOpen(row.id)} className="w-full px-3 py-2 text-left">
        <div className="flex items-start justify-between gap-2">
          <span className={`text-sm font-medium ${row.isCritical ? "text-red-700" : "text-slate-900"}`}>
            {row.type === "milestone" && <span className="mr-1 text-indigo-600">◆</span>}
            {row.canonicalScope ?? row.name}
          </span>
          {words ? (
            <span className="whitespace-nowrap text-xs font-semibold text-amber-700">{words}</span>
          ) : (
            <span className="whitespace-nowrap text-xs font-semibold text-emerald-600">on plan</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className={`inline-block h-2 w-2 rounded-sm border-l-0 ${paletteEntry(row.paletteIndex).bg}`} />
          {row.disciplineName && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5">
              {row.disciplineName}
              {row.partnerName ? ` · ${row.partnerName}` : ""}
            </span>
          )}
          {row.percentComplete !== null && row.percentComplete > 0 && <span>{row.percentComplete}% done</span>}
          {row.atRisk && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">AT RISK</span>
          )}
        </div>
      </button>
      {openId === row.id && (
        <div className="px-3 pb-2">
          <ActivityDetail row={row} sectionName={row.sectionName} />
        </div>
      )}
    </div>
  );
}

export function BucketView({
  rows,
  asOfIso,
  openId,
  onToggleOpen,
}: {
  rows: BucketRow[];
  asOfIso: string;
  openId: string | null;
  onToggleOpen(id: string): void;
}) {
  const asOf = new Date(asOfIso);
  const buckets = groupIntoBuckets(rows, asOf);

  return (
    <div>
      {BUCKET_ORDER.filter((k): k is Exclude<BucketKey, "done"> => k !== "done").map((key) =>
        buckets[key].length === 0 ? null : (
          <section key={key} className="mb-4">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-cyan-800">{bucketLabel(key, asOf)}</h3>
            {buckets[key].map((row) => (
              <Card key={row.id} row={row} openId={openId} onToggleOpen={onToggleOpen} />
            ))}
          </section>
        ),
      )}
      {buckets.done.length > 0 && (
        <details className="mb-4">
          <summary className="mb-2 cursor-pointer text-xs font-bold uppercase tracking-wide text-slate-500">
            Done · {buckets.done.length}
          </summary>
          {buckets.done.map((row) => (
            <Card key={row.id} row={row} openId={openId} onToggleOpen={onToggleOpen} />
          ))}
        </details>
      )}
    </div>
  );
}
