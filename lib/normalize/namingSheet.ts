import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { settleName } from "@/lib/normalize/normalizationService";

// Reviewed naming spreadsheets -> dictionary writes (scripts/apply-naming-review.ts).
// Two layouts: the reviewed dictionary sheet (Activity name / Action / Approved
// name), which is the whole standard list, and a review batch (Current name /
// Standard name), whose Standard name is an approved name or a keyword.

export type NamingOp =
  | { kind: "map"; name: string; scope: string }
  | { kind: "unmap"; name: string }
  | { kind: "ignore"; name: string }
  | { kind: "class"; name: string; class: "coarse" | "procurement"; covers: string[] };

export interface NamingPlan {
  ops: NamingOp[];
  /** The full standard list when the sheet defines it; null for a batch. */
  standard: string[] | null;
  /** Names a batch adds to the list (approveNew). */
  added: string[];
  problems: string[];
}

const ACTION = "Action (keep/merge/retire/map/ignore)";

export function planNamingSheet(rows: Record<string, string>[], approved: string[], approveNew: boolean): NamingPlan {
  const head = rows[0] ?? {};
  if ("Approved name" in head && ACTION in head) return planReview(rows);
  if ("Current name" in head && "Standard name" in head) return planBatch(rows, approved, approveNew);
  throw new Error(`Unrecognised columns: ${Object.keys(head).join(", ")}`);
}

function planReview(rows: Record<string, string>[]): NamingPlan {
  const ops: NamingOp[] = [];
  const standard = new Set<string>();
  for (const r of rows) {
    const name = r["Activity name"];
    const action = r[ACTION].trim().toLowerCase();
    const scope = r["Approved name"].trim();
    if (action === "retire") ops.push({ kind: "unmap", name });
    else if (action === "ignore") ops.push({ kind: "ignore", name });
    else if (scope) {
      standard.add(scope);
      ops.push({ kind: "map", name, scope });
    }
  }
  return { ops, standard: [...standard], added: [], problems: [] };
}

function planBatch(rows: Record<string, string>[], approved: string[], approveNew: boolean): NamingPlan {
  const byKey = new Map(approved.map((s) => [normalizeName(s), s]));
  const ops: NamingOp[] = [];
  const added: string[] = [];
  const problems: string[] = [];
  // Header is row 1, so data row i is spreadsheet row i + 2.
  const resolve = (value: string, row: number): string | null => {
    const known = byKey.get(normalizeName(value));
    if (known) return known;
    if (!approveNew) {
      problems.push(`row ${row}: "${value}" is not a standard name`);
      return null;
    }
    byKey.set(normalizeName(value), value);
    added.push(value);
    return value;
  };
  rows.forEach((r, i) => {
    const name = r["Current name"];
    const value = r["Standard name"].trim();
    const keyword = value.toLowerCase();
    if (!value || !name.trim()) return;
    if (keyword === "ignore") ops.push({ kind: "ignore", name });
    else if (keyword === "procurement") ops.push({ kind: "class", name, class: "procurement", covers: [] });
    else if (keyword === "coarse" || keyword.startsWith("coarse:")) {
      const covers = value.slice("coarse".length).replace(/^:/, "").split("+").map((s) => s.trim()).filter(Boolean)
        .map((s) => resolve(s, i + 2));
      if (covers.every((c) => c !== null)) ops.push({ kind: "class", name, class: "coarse", covers: covers as string[] });
    } else {
      const scope = resolve(value, i + 2);
      if (scope) ops.push({ kind: "map", name, scope });
    }
  });
  return { ops, standard: null, added, problems };
}

/**
 * Replacing the list keeps any name a split rule or trade entry still uses —
 * dropping it would strand that rule. Those are reported, not removed.
 */
export function listChanges(current: string[], sheet: string[], referenced: string[]) {
  const want = new Set(sheet);
  const used = new Set(referenced);
  const stale = current.filter((s) => !want.has(s));
  return {
    add: sheet.filter((s) => !current.includes(s)),
    remove: stale.filter((s) => !used.has(s)),
    kept: stale.filter((s) => used.has(s)),
  };
}

export async function applyNamingPlan(plan: NamingPlan) {
  const counts = { mapped: 0, unmapped: 0, ignored: 0, classified: 0, added: 0, removed: 0, kept: [] as string[] };
  const current = (await prisma.standardScope.findMany({ select: { name: true } })).map((s) => s.name);
  if (plan.standard) {
    const [rules, trades] = await Promise.all([prisma.scopeSplitRule.findMany(), prisma.tradeDictionaryEntry.findMany()]);
    const referenced = [...rules.flatMap((r) => [r.coarseScope, r.finerScope]), ...trades.map((t) => t.canonicalScope)];
    const change = listChanges(current, plan.standard, referenced);
    await prisma.standardScope.createMany({ data: change.add.map((name) => ({ name })) });
    await prisma.standardScope.deleteMany({ where: { name: { in: change.remove } } });
    counts.added = change.add.length;
    counts.removed = change.remove.length;
    counts.kept = change.kept;
  } else {
    const fresh = plan.added.filter((s) => !current.includes(s));
    await prisma.standardScope.createMany({ data: fresh.map((name) => ({ name })) });
    counts.added = fresh.length;
  }

  const [entries, ignored, classes] = await Promise.all([
    prisma.scopeDictionaryEntry.findMany(), prisma.scopeIgnoredName.findMany(), prisma.scopeNameClass.findMany(),
  ]);
  const entryOf = new Map(entries.map((e) => [e.normalizedName, e.canonicalScope]));
  const isIgnored = new Set(ignored.map((i) => i.normalizedName));
  const classOf = new Map(classes.map((c) => [c.normalizedName, `${c.kind}:${c.covers.join("+")}`]));
  for (const op of plan.ops) {
    const key = normalizeName(op.name);
    if (!key) continue;
    if (op.kind === "unmap") {
      if (entryOf.delete(key)) {
        await prisma.scopeDictionaryEntry.delete({ where: { normalizedName: key } });
        counts.unmapped++;
      }
    } else if (op.kind === "map") {
      if (entryOf.get(key) === op.scope) continue;
      await settleName(key, { mapTo: op.scope });
      entryOf.set(key, op.scope);
      counts.mapped++;
    } else if (op.kind === "ignore") {
      if (isIgnored.has(key)) continue;
      await settleName(key, { ignore: true });
      isIgnored.add(key);
      counts.ignored++;
    } else {
      const sig = `${op.class}:${op.covers.join("+")}`;
      if (classOf.get(key) === sig) continue;
      await settleName(key, { class: op.class, covers: op.covers });
      classOf.set(key, sig);
      counts.classified++;
    }
  }
  // A request for a name the sheet already settled the same way is settled too.
  const keys = plan.ops.filter((o) => o.kind !== "unmap").map((o) => normalizeName(o.name));
  await prisma.standardScopeRequest.deleteMany({ where: { normalizedName: { in: keys } } });
  return counts;
}
