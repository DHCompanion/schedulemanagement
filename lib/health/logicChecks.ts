// Pure, deterministic DCMA-style logic quality checks over a schedule's leaf
// activities and relationships. No DB, no AI. Computed at read time, like the
// date checks — imports are never mutated.

import { isLeafActive } from "@/lib/msp/types";
import { minutesToDays } from "@/lib/msp/duration";

// ponytail: DCMA 14-point defaults; calibrated against real files in the Phase 3 pilot.
export const MAX_MISSING_LOGIC = 0.05;
export const MAX_LEADS = 0;
export const MAX_LAGS = 0.05;
export const MAX_NON_FS = 0.1;
export const MAX_HARD_CONSTRAINTS = 0.05;
export const MAX_HIGH_FLOAT = 0.05;
export const MAX_NEGATIVE_FLOAT = 0;
export const MAX_HIGH_DURATION = 0.05;
export const MAX_OUT_OF_SEQUENCE = 0.05;
export const HIGH_DAYS = 44;
export const MIN_ELIGIBLE_SCORE = 0.6;

// MSPDI ConstraintType: 2 Must Start On, 3 Must Finish On, 5 Start No Later Than, 7 Finish No Later Than.
const HARD_CONSTRAINTS = new Set([2, 3, 5, 7]);

export interface LogicActivity {
  externalUid: number;
  type: string;
  isActive: boolean;
  isMilestone: boolean;
  durationMinutes: number | null;
  totalSlackMinutes: number | null;
  constraintType: number | null;
  actualStart: Date | null;
  actualFinish: Date | null;
}

export interface LogicRelationship {
  predecessorExternalUid: number;
  successorExternalUid: number;
  type: string;
  lagMinutes: number | null;
}

export type LogicMetricKey =
  | "missing_logic"
  | "leads"
  | "lags"
  | "non_fs"
  | "hard_constraints"
  | "high_float"
  | "negative_float"
  | "high_duration"
  | "out_of_sequence";

export interface LogicMetric {
  key: LogicMetricKey;
  count: number;
  denominator: number;
  pct: number;
  threshold: number;
  pass: boolean;
}

export interface LogicScore {
  metrics: LogicMetric[];
  passed: number;
  total: number;
  score: number;
  benchmarkEligible: boolean;
}

function metric(key: LogicMetricKey, count: number, denominator: number, threshold: number): LogicMetric {
  const pct = denominator === 0 ? 0 : count / denominator;
  return { key, count, denominator, pct, threshold, pass: pct <= threshold };
}

/**
 * Leaves missing a predecessor or successor. One open start and one open finish
 * are allowed — every network has a first and last activity.
 */
function countMissingLogic(leaves: LogicActivity[], rels: LogicRelationship[]): number {
  const hasPred = new Set(rels.map((r) => r.successorExternalUid));
  const hasSucc = new Set(rels.map((r) => r.predecessorExternalUid));
  let missing = 0;
  let openStart = false;
  let openFinish = false;
  for (const a of leaves) {
    const noPred = !hasPred.has(a.externalUid);
    const noSucc = !hasSucc.has(a.externalUid);
    if (!noPred && !noSucc) continue;
    if (noPred && !noSucc && !openStart) openStart = true;
    else if (noSucc && !noPred && !openFinish) openFinish = true;
    else missing++;
  }
  return missing;
}

function countOutOfSequence(byUid: Map<number, LogicActivity>, rels: LogicRelationship[]): { count: number; denominator: number } {
  let count = 0;
  let denominator = 0;
  for (const r of rels) {
    if (r.type !== "FS") continue;
    const succ = byUid.get(r.successorExternalUid)!;
    if (!succ.actualStart) continue;
    denominator++;
    const pred = byUid.get(r.predecessorExternalUid)!;
    if (!pred.actualFinish || pred.actualFinish.getTime() > succ.actualStart.getTime()) count++;
  }
  return { count, denominator };
}

export function scoreLogic(activities: LogicActivity[], relationships: LogicRelationship[], minutesPerDay: number): LogicScore {
  const leaves = activities.filter(isLeafActive);
  const byUid = new Map(leaves.map((a) => [a.externalUid, a]));
  // Links to summaries or inactive tasks don't drive the network, so they don't count as logic.
  const rels = relationships.filter((r) => byUid.has(r.predecessorExternalUid) && byUid.has(r.successorExternalUid));
  const days = (minutes: number | null) => minutesToDays(minutes, minutesPerDay);
  const leafCount = (pred: (a: LogicActivity) => boolean) => leaves.filter(pred).length;
  const relCount = (pred: (r: LogicRelationship) => boolean) => rels.filter(pred).length;
  const oos = countOutOfSequence(byUid, rels);

  const metrics: LogicMetric[] = [
    metric("missing_logic", countMissingLogic(leaves, rels), leaves.length, MAX_MISSING_LOGIC),
    metric("leads", relCount((r) => (r.lagMinutes ?? 0) < 0), rels.length, MAX_LEADS),
    metric("lags", relCount((r) => (r.lagMinutes ?? 0) > 0), rels.length, MAX_LAGS),
    metric("non_fs", relCount((r) => r.type !== "FS"), rels.length, MAX_NON_FS),
    metric("hard_constraints", leafCount((a) => HARD_CONSTRAINTS.has(a.constraintType ?? 0)), leaves.length, MAX_HARD_CONSTRAINTS),
    metric("high_float", leafCount((a) => (days(a.totalSlackMinutes) ?? 0) > HIGH_DAYS), leaves.length, MAX_HIGH_FLOAT),
    metric("negative_float", leafCount((a) => (a.totalSlackMinutes ?? 0) < 0), leaves.length, MAX_NEGATIVE_FLOAT),
    metric("high_duration", leafCount((a) => !a.isMilestone && (days(a.durationMinutes) ?? 0) > HIGH_DAYS), leaves.length, MAX_HIGH_DURATION),
    metric("out_of_sequence", oos.count, oos.denominator, MAX_OUT_OF_SEQUENCE),
  ];

  // Nothing started means nothing to judge — drop the metric rather than award a free pass.
  const scored = oos.denominator === 0 ? metrics.filter((m) => m.key !== "out_of_sequence") : metrics;
  const passed = scored.filter((m) => m.pass).length;
  const score = scored.length === 0 ? 0 : passed / scored.length;
  const logicPass = metrics[0].pass;
  return { metrics, passed, total: scored.length, score, benchmarkEligible: logicPass && score >= MIN_ELIGIBLE_SCORE };
}
