// Draft baseline assembly (roadmap Phase 7): one activity per chosen standard
// name, P75 planned duration, linked where most past projects link the pair,
// scheduled forward from a start date on a Mon–Fri calendar.

import { addWorkingDays } from "@/lib/forecast/workingDays";
import type { RelationshipType } from "@/lib/msp/relationshipType";

export interface DraftScope {
  name: string;
  /** Blended planned P75 in working days; null when the name has no range. */
  days: number | null;
  /** Projects of the building type behind the range; under THIN it leans on the sector. */
  typeN: number;
  /** Sector projects behind the range; under THIN the duration is a rough guess. */
  n: number;
}

export interface DraftLink {
  from: string;
  to: string;
  /** Share of projects with both names that link them (blended). */
  share: number;
  base: number;
  type: RelationshipType;
  lagDays: number;
}

export interface DraftPred {
  uid: number;
  type: RelationshipType;
  lagDays: number;
  /** Under LINK_SHARE: kept only as the activity's commonest neighbour. */
  weak: boolean;
}

export interface DraftActivity {
  uid: number;
  name: string;
  days: number;
  start: Date;
  finish: Date;
  milestone: boolean;
  preds: DraftPred[];
  lowConfidence: boolean;
}

export interface Draft {
  activities: DraftActivity[];
  warnings: string[];
  workingDays: number;
}

export const LINK_SHARE = 0.5;
// Waiting periods schedules model as tasks (NTP Received at 186 days): a draft makes them milestones (decided 2026-10-27).
export const DRAFT_MILESTONES = new Set(["Notice of Award", "Notice to Proceed", "Owner Contract Executed", "Permit Issued", "Permit Received", "Substantial Completion", "Certificate of Occupancy", "Turnover"]);
export const THIN = 5;

const DAY_START_H = 8;
const DAY_END_H = 17;

/** Drop the weakest link of each loop until none is left. */
function breakLoops(names: string[], links: DraftLink[], warnings: string[]): DraftLink[] {
  let kept = [...links];
  for (;;) {
    const out = new Map(names.map((n) => [n, kept.filter((l) => l.from === n)]));
    const state = new Map<string, "open" | "done">();
    const stack: DraftLink[] = [];
    let loop: DraftLink[] | null = null;
    const visit = (n: string): void => {
      state.set(n, "open");
      for (const l of out.get(n) ?? []) {
        if (loop) return;
        stack.push(l);
        if (state.get(l.to) === "open") loop = stack.slice(stack.findIndex((s) => s.from === l.to));
        else if (!state.has(l.to)) visit(l.to);
        stack.pop();
      }
      state.set(n, "done");
    };
    for (const n of names) if (!loop && !state.has(n)) visit(n);
    if (!loop) return kept;
    const weakest = (loop as DraftLink[]).reduce((w, l) => (l.share < w.share || (l.share === w.share && l.base < w.base) ? l : w));
    warnings.push(`Dropped ${weakest.from} → ${weakest.to} to break a loop.`);
    kept = kept.filter((l) => l !== weakest);
  }
}

export function assembleDraft(scopes: DraftScope[], links: DraftLink[], start: Date): Draft {
  const warnings: string[] = [];
  const nodes = new Map<string, { days: number; typeN: number; n: number }>();
  for (const s of scopes) {
    if (DRAFT_MILESTONES.has(s.name)) { nodes.set(s.name, { days: 0, typeN: s.typeN, n: s.n }); continue; }
    if (s.days === null) { warnings.push(`${s.name}: no duration data, left out.`); continue; }
    if (s.n < THIN) warnings.push(`${s.name}: only ${s.n} project${s.n === 1 ? "" : "s"}, duration is a rough guess.`);
    nodes.set(s.name, { days: Math.max(1, Math.ceil(s.days)), typeN: s.typeN, n: s.n });
  }
  const names = [...nodes.keys()].sort((a, b) => a.localeCompare(b));
  // Links most projects with both names use; then, for an activity left with
  // no predecessor or successor, its commonest one (decided 2026-10-26).
  const candidates = links.filter((l) => nodes.has(l.from) && nodes.has(l.to) && l.from !== l.to);
  const strong = candidates.filter((l) => l.share >= LINK_SHARE);
  const strongest = (ls: DraftLink[]) => ls.sort((a, b) => b.share - a.share || b.base - a.base)[0];
  const weak = new Set<DraftLink>();
  for (const n of names) {
    const into = !strong.some((l) => l.to === n) && strongest(candidates.filter((l) => l.to === n && l.share < LINK_SHARE));
    const out = !strong.some((l) => l.from === n) && strongest(candidates.filter((l) => l.from === n && l.share < LINK_SHARE));
    if (into) weak.add(into);
    if (out) weak.add(out);
  }
  const usable = breakLoops(names, [...strong, ...weak], warnings);

  // Topological order, alphabetical among ready names so the draft is stable.
  const incoming = new Map(names.map((n) => [n, usable.filter((l) => l.to === n)]));
  const order: string[] = [];
  const ready = names.filter((n) => incoming.get(n)!.length === 0);
  const placed = new Set<string>();
  while (ready.length) {
    const n = ready.shift()!;
    order.push(n);
    placed.add(n);
    for (const m of names) {
      if (!placed.has(m) && !ready.includes(m) && incoming.get(m)!.every((l) => placed.has(l.from))) ready.push(m);
    }
    ready.sort((a, b) => a.localeCompare(b));
  }

  // Forward pass in working-day indices: an activity occupies days es … es + days − 1.
  const es = new Map<string, number>();
  for (const n of order) {
    const d = nodes.get(n)!.days;
    let at = 0;
    for (const l of incoming.get(n)!) {
      const pes = es.get(l.from)!;
      const pef = pes + nodes.get(l.from)!.days - 1;
      const lag = Math.round(l.lagDays);
      // A day's 17:00 finish meets the next working day's 08:00 start, so SF ends the day before.
      const need = { FS: pef + 1 + lag, SS: pes + lag, FF: pef + lag - d + 1, SF: pes + lag - d }[l.type];
      at = Math.max(at, need);
    }
    es.set(n, at);
  }

  const dayStart = (i: number) => {
    const d = addWorkingDays(start, i);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DAY_START_H));
  };
  const dayEnd = (i: number) => {
    const d = dayStart(i);
    d.setUTCHours(DAY_END_H);
    return d;
  };
  const uid = new Map(order.map((n, i) => [n, i + 2]));
  // An activity is an open end unless some successor finishes no earlier than it
  // does (MS Project would otherwise pull Finish in ahead of it).
  const ef = (n: string) => es.get(n)! + nodes.get(n)!.days - 1;
  const hasSuccessor = new Set(usable.filter((l) => ef(l.to) >= ef(l.from)).map((l) => l.from));
  const lastDay = Math.max(0, ...order.map((n) => es.get(n)! + nodes.get(n)!.days - 1));
  // A closing milestone sits at the next day's 08:00, the same working moment as lastDay's 17:00: Finish goes no earlier.
  const finishAt = new Date(Math.max(dayEnd(lastDay).getTime(), ...order.filter((n) => nodes.get(n)!.days === 0).map((n) => dayStart(es.get(n)!).getTime())));

  const activities: DraftActivity[] = [
    { uid: 1, name: "Start", days: 0, start: dayStart(0), finish: dayStart(0), milestone: true, preds: [], lowConfidence: false },
    ...order.map((n) => {
      const { days, typeN } = nodes.get(n)!;
      const preds = incoming.get(n)!.map((l) => ({ uid: uid.get(l.from)!, type: l.type, lagDays: Math.round(l.lagDays), weak: weak.has(l) }));
      return {
        uid: uid.get(n)!, name: n, days, start: dayStart(es.get(n)!), finish: days === 0 ? dayStart(es.get(n)!) : dayEnd(es.get(n)! + days - 1), milestone: days === 0,
        preds: preds.length ? preds : [{ uid: 1, type: "FS" as const, lagDays: 0, weak: false }], lowConfidence: typeN < THIN,
      };
    }),
    {
      uid: order.length + 2, name: "Finish", days: 0, start: finishAt, finish: finishAt, milestone: true,
      preds: order.filter((n) => !hasSuccessor.has(n)).map((n) => ({ uid: uid.get(n)!, type: "FS" as const, lagDays: 0, weak: false })),
      lowConfidence: false,
    },
  ];
  const weakKept = usable.filter((l) => weak.has(l)).length;
  if (weakKept) warnings.push(`${weakKept} link${weakKept === 1 ? " is" : "s are"} an activity's commonest neighbour but used by under half the projects.`);
  const thinLinks = usable.filter((l) => l.base < THIN).length;
  if (thinLinks) warnings.push(`${thinLinks} link${thinLinks === 1 ? " rests" : "s rest"} on fewer than ${THIN} projects.`);
  // Names under THIN sector projects were warned about one by one above.
  const thinNames = order.filter((n) => nodes.get(n)!.typeN < THIN && nodes.get(n)!.n >= THIN).length;
  if (thinNames) warnings.push(`${thinNames} of ${order.length} durations lean on the sector (fewer than ${THIN} projects of this type).`);
  return { activities, warnings, workingDays: order.length ? lastDay + 1 : 0 };
}
