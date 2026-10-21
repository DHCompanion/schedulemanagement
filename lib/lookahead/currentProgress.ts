import type { ActivityProgress, ProgressStatus } from "@/lib/lookahead/computeLookahead";
import { canonicalActivityKey, finerActivityKey } from "@/lib/msp/canonicalKey";

export interface FinalizedEntry {
  canonicalActivityKey: string;
  finalizedAt: Date;
  status: string;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number | null;
  note: string | null;
  forecastStart?: Date | null;
  forecastFinish?: Date | null;
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
      forecastStart: e.forecastStart ?? null,
      forecastFinish: e.forecastFinish ?? null,
    });
  }
  return out;
}

export interface SplitKeys {
  coarseWbsCode: string | null;
  coarseName: string;
  finerScopes: string[];
}

/**
 * Progress finalized against a coarse activity is copied to each finer activity
 * a split replaced it with — otherwise work already reported complete reads as
 * not started once the coarse key leaves the schedule. Splits go oldest first,
 * so a finer activity that was itself split passes the progress on again.
 * Any entry made later on a finer activity itself still wins on finalizedAt.
 */
export function carryProgressThroughSplits(entries: FinalizedEntry[], splits: SplitKeys[]): FinalizedEntry[] {
  const out = [...entries];
  for (const s of splits) {
    const coarseKey = canonicalActivityKey(s.coarseWbsCode, s.coarseName);
    const coarseEntries = out.filter((e) => e.canonicalActivityKey === coarseKey);
    for (const e of coarseEntries) {
      s.finerScopes.forEach((scope, i) => out.push({ ...e, canonicalActivityKey: finerActivityKey(s.coarseWbsCode, scope, i) }));
    }
  }
  return out;
}
