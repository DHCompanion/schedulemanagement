import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { settleName } from "@/lib/normalize/normalizationService";
import { deleteStandardScope, renameStandardScope } from "@/lib/normalize/renameStandardScope";

// Reviewed naming spreadsheets -> dictionary writes (scripts/apply-naming-review.ts).
// Two layouts: the reviewed dictionary sheet (Activity name / Action / Approved
// name), which is the whole standard list, and a review batch (Current name /
// Standard name), whose Standard name is an approved name or a keyword.

export type NamingOp =
  | { kind: "map"; name: string; scope: string }
  | { kind: "unmap"; name: string }
  | { kind: "ignore"; name: string }
  | { kind: "class"; name: string; class: "coarse" | "procurement"; covers: string[] }
  | { kind: "rename"; name: string; to: string }
  | { kind: "delete"; name: string };

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
  if ("From name" in head && "To name" in head) return planMerges(rows);
  throw new Error(`Unrecognised columns: ${Object.keys(head).join(", ")}`);
}

// A merge sheet (From name / To name) renames or merges standard names, in row order; "delete" drops one.
function planMerges(rows: Record<string, string>[]): NamingPlan {
  const ops: NamingOp[] = [];
  for (const r of rows) {
    const [name, to] = [r["From name"].trim(), r["To name"].trim()];
    if (!name || !to) continue;
    ops.push(to.toLowerCase() === "delete" ? { kind: "delete", name } : { kind: "rename", name, to });
  }
  return { ops, standard: null, added: [], problems: [] };
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
    // Standard names are title case; one lowercase word is a keyword typo like "corase".
    if (/^[a-z]+$/.test(value)) {
      problems.push(`row ${row}: "${value}" looks like a misspelled keyword`);
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
    else if (/^coarse\s*(:|$)/.test(keyword)) {
      const list = value.replace(/^coarse\s*:?/i, "").trim();
      // "+" separates covers; commas do too, unless the text is one name that has commas ("Tape, Bed, and Paint").
      const parts = list.includes("+") || byKey.has(normalizeName(list)) ? list.split("+") : list.split(",");
      const covers = parts.map((s) => s.trim()).filter(Boolean).map((s) => resolve(s, i + 2));
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

/**
 * The list change a full-list sheet makes. Names still used after the sheet is
 * applied — by a dictionary entry the sheet leaves alone, a split rule or a
 * trade entry — are kept and reported, so nothing points at an unlisted name.
 */
export async function planListChange(plan: NamingPlan & { standard: string[] }, current: string[]) {
  const touched = new Set(plan.ops.map((o) => normalizeName(o.name)));
  const [entries, rules, trades] = await Promise.all([
    prisma.scopeDictionaryEntry.findMany(), prisma.scopeSplitRule.findMany(), prisma.tradeDictionaryEntry.findMany(),
  ]);
  const referenced = [
    ...entries.filter((e) => !touched.has(e.normalizedName)).map((e) => e.canonicalScope),
    ...rules.flatMap((r) => [r.coarseScope, r.finerScope]),
    ...trades.map((t) => t.canonicalScope),
  ];
  return listChanges(current, plan.standard, referenced);
}

export async function applyNamingPlan(plan: NamingPlan) {
  const counts = { mapped: 0, unmapped: 0, ignored: 0, classified: 0, renamed: 0, deleted: 0, added: 0, removed: 0, kept: [] as string[], conflicts: [] as string[] };
  const current = (await prisma.standardScope.findMany({ select: { name: true } })).map((s) => s.name);
  const change = plan.standard ? await planListChange({ ...plan, standard: plan.standard }, current) : null;
  const fresh = change ? change.add : plan.added.filter((s) => !current.includes(s));
  await prisma.standardScope.createMany({ data: fresh.map((name) => ({ name })) });
  counts.added = fresh.length;

  const [entries, ignored, classes] = await Promise.all([
    prisma.scopeDictionaryEntry.findMany(), prisma.scopeIgnoredName.findMany(), prisma.scopeNameClass.findMany(),
  ]);
  const entryOf = new Map(entries.map((e) => [e.normalizedName, e.canonicalScope]));
  const isIgnored = new Set(ignored.map((i) => i.normalizedName));
  const classOf = new Map(classes.map((c) => [c.normalizedName, `${c.kind}:${c.covers.join("+")}`]));
  // Several rows can share a key; the last one is the reviewer's final word.
  const finalOps = new Map(plan.ops.map((op) => [normalizeName(op.name), op]));
  finalOps.delete("");
  for (const [key, op] of finalOps) {
    if (op.kind === "rename") {
      // A row whose From name is already gone was done on an earlier run.
      if (!(await prisma.standardScope.findFirst({ where: { name: { equals: op.name.trim(), mode: "insensitive" } } }))) continue;
      const r = await renameStandardScope(op.name, op.to);
      if (r.from !== r.to) counts.renamed++;
      counts.conflicts.push(...r.conflicts);
    } else if (op.kind === "delete") {
      if (!(await prisma.standardScope.findUnique({ where: { name: op.name.trim() } }))) continue;
      await deleteStandardScope(op.name);
      counts.deleted++;
    } else if (op.kind === "unmap") {
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
  const keys = plan.ops.filter((o) => o.kind === "map" || o.kind === "ignore" || o.kind === "class").map((o) => normalizeName(o.name));
  await prisma.standardScopeRequest.deleteMany({ where: { normalizedName: { in: keys } } });
  // Names leave the list last, once nothing the sheet re-pointed still uses them.
  if (change) {
    await prisma.standardScope.deleteMany({ where: { name: { in: change.remove } } });
    counts.removed = change.remove.length;
    counts.kept = change.kept;
  }
  return counts;
}
