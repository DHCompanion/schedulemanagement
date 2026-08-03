import type { ActivityProgress } from "@/lib/lookahead/computeLookahead";
import { baselineProgress } from "@/lib/lookahead/computeLookahead";
import { addWorkingDays, workingDaysBetween } from "./workingDays";

export interface ForecastActivity {
  externalUid: number;
  canonicalActivityKey: string;
  type: string;
  isActive: boolean;
  plannedStart: Date | null;
  plannedFinish: Date | null;
  durationDays: number | null;
  actualStart: Date | null;
  actualFinish: Date | null;
  percentComplete: number | null;
}

export interface ForecastRelationship {
  predecessorExternalUid: number;
  successorExternalUid: number;
  type: string;
  lagMinutes: number | null;
}

export interface ActivityForecast {
  expectedStart: Date | null;
  expectedFinish: Date | null;
  driftDays: number;
  pushedByUid: number | null;
}

export interface ForecastInput {
  activities: ForecastActivity[];
  relationships: ForecastRelationship[];
  progressByKey: Map<string, ActivityProgress>;
  statusDate: Date;
  minutesPerDay?: number | null;
}

interface Edge {
  pred: number;
  succ: number;
  type: "FS" | "SS";
  lagDays: number;
}

function isLeaf(a: ForecastActivity): boolean {
  return a.isActive && a.type !== "summary" && a.type !== "project_summary";
}

function plannedDuration(a: ForecastActivity): number {
  if (a.durationDays !== null) return a.durationDays;
  if (a.plannedStart && a.plannedFinish) return Math.max(0, workingDaysBetween(a.plannedStart, a.plannedFinish));
  return 0;
}

function forecastOne(
  a: ForecastActivity,
  p: ActivityProgress,
  preds: Edge[],
  done: Map<number, ActivityForecast>,
  statusDate: Date,
  skipPush: boolean,
): ActivityForecast {
  if (p.status === "complete") {
    const expectedFinish = p.actualFinish ?? a.plannedFinish;
    return {
      expectedStart: p.actualStart ?? a.plannedStart,
      expectedFinish,
      driftDays: a.plannedFinish && expectedFinish ? workingDaysBetween(a.plannedFinish, expectedFinish) : 0,
      pushedByUid: null,
    };
  }

  if (p.status === "in_progress") {
    // Started work is never pushed by predecessors — reality wins (out-of-sequence rule).
    const pct = Math.min(99, Math.max(0, p.percentComplete ?? 0));
    const remaining = plannedDuration(a) * (1 - pct / 100);
    let expectedFinish = addWorkingDays(statusDate, remaining);
    if (a.plannedFinish && expectedFinish < a.plannedFinish) expectedFinish = a.plannedFinish; // never earlier than planned
    return {
      expectedStart: p.actualStart ?? a.plannedStart,
      expectedFinish,
      driftDays: a.plannedFinish ? Math.max(0, workingDaysBetween(a.plannedFinish, expectedFinish)) : 0,
      pushedByUid: null,
    };
  }

  // Not started. Pushes are computed date-granularly as whole working days and
  // applied by shifting the planned timestamps — so an unpushed activity keeps
  // its planned dates exactly, and drift propagates undiminished through
  // zero-lag FS chains.
  if (!a.plannedStart) {
    return { expectedStart: null, expectedFinish: a.plannedFinish, driftDays: 0, pushedByUid: null };
  }
  let pushDays = 0;
  let pushedByUid: number | null = null;
  if (!skipPush) {
    for (const e of preds) {
      const pf = done.get(e.pred);
      if (!pf) continue;
      // FS: earliest start is the next working date after the predecessor's
      // expected finish, plus lag. SS: starts tie, plus lag.
      const basis = e.type === "FS" ? pf.expectedFinish : pf.expectedStart;
      if (!basis) continue;
      const candidate = addWorkingDays(basis, (e.type === "FS" ? 1 : 0) + e.lagDays);
      const push = workingDaysBetween(a.plannedStart, candidate);
      if (push > pushDays) {
        pushDays = push;
        pushedByUid = e.pred;
      }
    }
  }
  if (pushDays === 0) {
    return { expectedStart: a.plannedStart, expectedFinish: a.plannedFinish, driftDays: 0, pushedByUid: null };
  }
  const expectedStart = addWorkingDays(a.plannedStart, pushDays);
  const expectedFinish = a.plannedFinish
    ? addWorkingDays(a.plannedFinish, pushDays)
    : addWorkingDays(expectedStart, plannedDuration(a));
  return { expectedStart, expectedFinish, driftDays: pushDays, pushedByUid };
}

/**
 * Forward-pass forecast per the redesign spec: completed uses actuals,
 * in-progress extends from the status date, not-started is pushed by FS/SS
 * predecessors, never earlier than planned. Not CPM: no float, no leveling,
 * weekends only; FF/SF edges do not push in v1.
 */
export function computeForecast(input: ForecastInput): Map<number, ActivityForecast> {
  const mpd = input.minutesPerDay || 480;
  const leaves = input.activities.filter(isLeaf);
  const byUid = new Map(leaves.map((a) => [a.externalUid, a]));

  const incoming = new Map<number, Edge[]>();
  const outgoing = new Map<number, Edge[]>();
  const indegree = new Map<number, number>([...byUid.keys()].map((uid) => [uid, 0]));
  for (const r of input.relationships) {
    if (r.type !== "FS" && r.type !== "SS") continue; // FF/SF don't push in v1
    if (!byUid.has(r.predecessorExternalUid) || !byUid.has(r.successorExternalUid)) continue;
    const e: Edge = {
      pred: r.predecessorExternalUid,
      succ: r.successorExternalUid,
      type: r.type,
      lagDays: (r.lagMinutes ?? 0) / mpd,
    };
    if (!incoming.has(e.succ)) incoming.set(e.succ, []);
    incoming.get(e.succ)!.push(e);
    if (!outgoing.has(e.pred)) outgoing.set(e.pred, []);
    outgoing.get(e.pred)!.push(e);
    indegree.set(e.succ, (indegree.get(e.succ) ?? 0) + 1);
  }

  // Kahn's topological order so predecessors are forecast before successors.
  const queue = [...byUid.keys()].filter((uid) => indegree.get(uid) === 0);
  const order: number[] = [];
  while (queue.length) {
    const uid = queue.shift()!;
    order.push(uid);
    for (const e of outgoing.get(uid) ?? []) {
      const d = indegree.get(e.succ)! - 1;
      indegree.set(e.succ, d);
      if (d === 0) queue.push(e.succ);
    }
  }
  // Cycle guard: malformed data can loop; members fall back to planned dates unpushed.
  const ordered = new Set(order);
  const inCycle = new Set([...byUid.keys()].filter((uid) => !ordered.has(uid)));
  for (const uid of inCycle) order.push(uid);

  const out = new Map<number, ActivityForecast>();
  for (const uid of order) {
    const a = byUid.get(uid)!;
    const p = input.progressByKey.get(a.canonicalActivityKey) ?? baselineProgress(a);
    out.set(uid, forecastOne(a, p, incoming.get(uid) ?? [], out, input.statusDate, inCycle.has(uid)));
  }
  return out;
}

export interface ProjectDrift {
  driftDays: number;
  activityUid: number | null;
}

/** Spec: project drift = drift of the latest-finishing incomplete activity. */
export function projectDrift(
  activities: ForecastActivity[],
  forecasts: Map<number, ActivityForecast>,
  progressByKey: Map<string, ActivityProgress>,
): ProjectDrift {
  let latest: { uid: number; finish: Date; drift: number } | null = null;
  for (const a of activities) {
    if (!isLeaf(a)) continue;
    const p = progressByKey.get(a.canonicalActivityKey) ?? baselineProgress(a);
    if (p.status === "complete") continue;
    const f = forecasts.get(a.externalUid);
    if (!f?.expectedFinish) continue;
    if (!latest || f.expectedFinish > latest.finish) {
      latest = { uid: a.externalUid, finish: f.expectedFinish, drift: f.driftDays };
    }
  }
  return latest ? { driftDays: latest.drift, activityUid: latest.uid } : { driftDays: 0, activityUid: null };
}
