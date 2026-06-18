import type { ActivityProgress, ProgressStatus } from "@/lib/lookahead/computeLookahead";

export interface FinalizedEntry {
  canonicalActivityKey: string;
  finalizedAt: Date;
  status: string;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number | null;
  note: string | null;
}

/** Latest finalized entry per canonicalActivityKey wins. */
export function resolveCurrentProgress(entries: FinalizedEntry[]): Map<string, ActivityProgress> {
  const latest = new Map<string, FinalizedEntry>();
  for (const e of entries) {
    const prev = latest.get(e.canonicalActivityKey);
    if (!prev || e.finalizedAt > prev.finalizedAt) latest.set(e.canonicalActivityKey, e);
  }
  const out = new Map<string, ActivityProgress>();
  for (const [key, e] of latest) {
    out.set(key, {
      status: e.status as ProgressStatus,
      actualStart: e.actualStart,
      actualFinish: e.actualFinish,
      percentComplete: e.percentComplete,
      note: e.note,
    });
  }
  return out;
}
