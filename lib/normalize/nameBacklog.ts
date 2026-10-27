// The name review backlog (2026-10-27): unsettled names from the schedules that
// feed benchmarks, each with a suggested outcome, worked through one at a time
// in the /history/names dialog. Suggestions never apply themselves (Q72).

import { prisma } from "@/lib/db";
import { confirmMapping, getDictionary, getKnownScopes, getNameStatus, settleName, settleNames, addStandardScope } from "@/lib/normalize/normalizationService";

export const BACKLOG_KINDS = ["map", "coarse", "procurement", "ignore", "new"] as const;
export const CONFIDENCES = ["high", "medium", "low"] as const;

// A type, not an interface, so it passes as Prisma JSON.
export type BacklogSample = { project: string; type: string; parent: string; days: number };

export interface BacklogRow {
  normalizedName: string;
  rawName: string;
  taskCount: number;
  projectCount: number;
  samples: BacklogSample[];
  kind: string;
  suggestion: string;
  covers: string[];
  confidence: string;
  reason: string;
  source: string;
  poolTasks: number;
}

export interface BacklogProgress {
  names: number;
  settledNames: number;
  poolTasks: number;
  /** Share of the pool's tasks settled: everything outside the backlog plus backlog names settled since. */
  coverage: number;
  /** Unsettled high-confidence "map" suggestions: what approving all high-confidence maps. */
  high: number;
}

/** Unsettled rows, most tasks first (the first `limit`), and progress against the pool. */
export function summarizeBacklog(all: BacklogRow[], settled: (normalizedName: string) => boolean, limit: number): { rows: BacklogRow[]; progress: BacklogProgress; high: { rawName: string; suggestion: string }[] } {
  const open = all.filter((r) => !settled(r.normalizedName)).sort((a, b) => b.taskCount - a.taskCount || a.normalizedName.localeCompare(b.normalizedName));
  const poolTasks = Math.max(0, ...all.map((r) => r.poolTasks));
  const unsettledTasks = open.reduce((n, r) => n + r.taskCount, 0);
  const high = open.filter((r) => r.confidence === "high" && r.kind === "map");
  return {
    rows: open.slice(0, limit),
    progress: {
      names: all.length,
      settledNames: all.length - open.length,
      poolTasks,
      coverage: poolTasks ? (poolTasks - unsettledTasks) / poolTasks : 1,
      high: high.length,
    },
    high: high.map((r) => ({ rawName: r.rawName, suggestion: r.suggestion })),
  };
}

async function settledCheck() {
  const [dict, status] = await Promise.all([getDictionary(), getNameStatus()]);
  return (n: string) => dict.has(n) || status.settled.has(n);
}

export async function getBacklog(limit = 25) {
  const [rows, settled] = await Promise.all([prisma.scopeNameSuggestion.findMany(), settledCheck()]);
  return summarizeBacklog(rows as unknown as BacklogRow[], settled, limit);
}

export type BacklogAction =
  | { name: string; action: "map" | "new"; scope: string }
  | { name: string; action: "coarse"; covers?: string[] }
  | { name: string; action: "procurement" | "ignore" };

/** Settle one backlog name. Throws a user-facing message for an unlisted scope. */
export async function applyBacklogAction(a: BacklogAction): Promise<void> {
  if (a.action === "map") return confirmMapping(a.name, a.scope);
  if (a.action === "new") return settleName(a.name, { mapTo: await addStandardScope(a.scope) });
  if (a.action === "ignore") return settleName(a.name, { ignore: true });
  const known = new Set(await getKnownScopes());
  return settleName(a.name, { class: a.action, covers: a.action === "coarse" ? (a.covers ?? []).filter((c) => known.has(c)) : [] });
}

/** Map every unsettled high-confidence "map" suggestion to its listed standard name. */
export async function approveHighConfidence(): Promise<number> {
  const [rows, settled, known] = await Promise.all([
    prisma.scopeNameSuggestion.findMany({ where: { confidence: "high", kind: "map" } }),
    settledCheck(),
    getKnownScopes().then((s) => new Set(s)),
  ]);
  const items = rows.filter((r) => !settled(r.normalizedName) && known.has(r.suggestion)).map((r) => ({ normalizedName: r.normalizedName, outcome: { mapTo: r.suggestion } }));
  if (items.length) await settleNames(items);
  return items.length;
}

/**
 * Check a loaded suggestion set: known kinds and confidences, a "map" to an
 * unlisted name becomes a proposed new name, coarse covers keep listed names only.
 */
export function planSuggestions(input: Record<string, unknown>[], knownScopes: string[]): BacklogRow[] {
  const known = new Set(knownScopes);
  return input.map((r) => {
    const kind = String(r.kind), confidence = String(r.confidence), suggestion = String(r.suggestion ?? "").trim();
    if (!(BACKLOG_KINDS as readonly string[]).includes(kind)) throw new Error(`${r.normalizedName}: unknown kind "${kind}".`);
    if (!(CONFIDENCES as readonly string[]).includes(confidence)) throw new Error(`${r.normalizedName}: unknown confidence "${confidence}".`);
    return {
      normalizedName: String(r.normalizedName), rawName: String(r.rawName), taskCount: Number(r.taskCount), projectCount: Number(r.projectCount),
      samples: (r.samples ?? []) as BacklogSample[], poolTasks: Number(r.poolTasks),
      kind: kind === "map" && suggestion && !known.has(suggestion) ? "new" : kind,
      suggestion, covers: Array.isArray(r.covers) ? r.covers.map(String).filter((c) => known.has(c)) : [],
      confidence, reason: String(r.reason ?? ""), source: String(r.source ?? "ai"),
    };
  });
}
