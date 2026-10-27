// The name review backlog (2026-10-27).
//
//   npx tsx scripts/name-backlog.ts export <out.json>          read-only
//   npx tsx scripts/name-backlog.ts load [--apply] <in.json>   dry run unless --apply
//
// export: every unsettled leaf-task name in the pool (each benchmark project's
// earliest eligible schedule, plus each live project's latest), with task and
// project counts, example tasks, a matcher suggestion, and the standard names
// with mapped examples, as context for the AI pass.
// load: replaces the suggestion table with the file's names. A name the AI pass
// filled (kind, suggestion, covers, confidence, reason) keeps its answer;
// the rest keep the matcher's.
//
// Writes to whatever DATABASE_URL points at.

import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { importQuality } from "@/lib/health/healthService";
import { isLeafActive } from "@/lib/msp/types";
import { isWeekend, workingDaysBetween } from "@/lib/forecast/workingDays";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { bestMatch } from "@/lib/normalize/suggestScopes";
import { getDictionary, getKnownScopes, getNameStatus } from "@/lib/normalize/normalizationService";
import { planSuggestions, type BacklogSample } from "@/lib/normalize/nameBacklog";

const ELIGIBLE = new Set(["as_built", "baseline"]);
const SAMPLES = 3;

async function exportBacklog(out: string) {
  const [dict, status, known] = await Promise.all([getDictionary(), getNameStatus(), getKnownScopes()]);
  const projects = await prisma.project.findMany({
    where: { OR: [{ useInBenchmarks: true, sector: { not: null }, status: "historical" }, { NOT: { status: "historical" } }] },
    select: { name: true, status: true, buildingType: true, subType: true, imports: { where: { isSynthetic: false }, orderBy: { importedAt: "asc" }, select: { id: true } } },
  });
  let poolTasks = 0;
  const names = new Map<string, { spellings: Map<string, number>; taskCount: number; projects: Set<string>; samples: BacklogSample[] }>();
  for (const p of projects) {
    const live = p.status !== "historical";
    const ids = p.imports.map((i) => i.id);
    for (const id of live ? ids.slice(-1) : ids) {
      const imp = await prisma.scheduleImport.findUnique({ where: { id }, include: { activities: true, relationships: true } });
      if (!imp || (!live && !ELIGIBLE.has(importQuality(imp).tier))) continue;
      const parentOf = new Map(imp.activities.map((a) => [a.externalUid, a.name]));
      for (const a of imp.activities) {
        if (!isLeafActive(a) || a.isMilestone) continue;
        poolTasks++;
        const key = normalizeName(a.name);
        if (!key || dict.has(key) || status.settled.has(key)) continue;
        const n = names.get(key) ?? { spellings: new Map<string, number>(), taskCount: 0, projects: new Set<string>(), samples: [] as BacklogSample[] };
        n.spellings.set(a.name.trim(), (n.spellings.get(a.name.trim()) ?? 0) + 1);
        n.taskCount++;
        if (!n.projects.has(p.name) && n.samples.length < SAMPLES) {
          const days = a.plannedStart && a.plannedFinish ? workingDaysBetween(a.plannedStart, a.plannedFinish) + (isWeekend(a.plannedStart) ? 0 : 1) : 0;
          n.samples.push({ project: p.name, type: [p.buildingType, p.subType].filter(Boolean).join(" / "), parent: a.parentExternalUid === null ? "" : parentOf.get(a.parentExternalUid) ?? "", days });
        }
        n.projects.add(p.name);
        names.set(key, n);
      }
      break;
    }
  }
  const examples = new Map<string, string[]>();
  for (const [name, scope] of dict) if ((examples.get(scope)?.length ?? 0) < 5) examples.set(scope, [...(examples.get(scope) ?? []), name]);
  const rows = [...names].sort((a, b) => b[1].taskCount - a[1].taskCount).map(([normalizedName, n]) => {
    const match = bestMatch(normalizedName, known, dict);
    return {
      normalizedName, rawName: [...n.spellings].sort((a, b) => b[1] - a[1])[0][0], taskCount: n.taskCount, projectCount: n.projects.size, samples: n.samples, poolTasks,
      kind: "map", suggestion: match?.scope ?? "", covers: [], confidence: !match ? "low" : match.score >= 0.75 ? "high" : match.score >= 0.5 ? "medium" : "low",
      reason: match ? `Matcher: ${Math.round(match.score * 100)}% word overlap.` : "No overlap with a standard name.", source: "matcher",
    };
  });
  writeFileSync(out, JSON.stringify({ poolTasks, standards: known.map((name) => ({ name, examples: examples.get(name) ?? [] })), names: rows }, null, 1));
  const unsettled = rows.reduce((s, r) => s + r.taskCount, 0);
  console.log(`${rows.length} unsettled names, ${unsettled} of ${poolTasks} pool tasks (coverage ${(100 * (1 - unsettled / poolTasks)).toFixed(1)}%) → ${out}`);
}

async function load(file: string, apply: boolean) {
  const { names } = JSON.parse(readFileSync(file, "utf8")) as { names: Record<string, unknown>[] };
  const rows = planSuggestions(names, await getKnownScopes());
  const tally = (key: "kind" | "confidence" | "source") => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r[key], (counts.get(r[key]) ?? 0) + 1);
    return [...counts].map(([k, n]) => `${k} ${n}`).join(", ");
  };
  console.log(`${rows.length} suggestions — ${tally("kind")} — ${tally("confidence")} — ${tally("source")}`);
  if (!apply) return console.log("Dry run; pass --apply to replace the backlog.");
  await prisma.$transaction([prisma.scopeNameSuggestion.deleteMany(), prisma.scopeNameSuggestion.createMany({ data: rows })]);
  console.log("Backlog replaced.");
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const file = rest.find((a) => !a.startsWith("--"));
  console.log(`${new URL(process.env.DATABASE_URL ?? "postgres://unset").host || "local"} — ${mode === "load" && rest.includes("--apply") ? "APPLYING" : "read-only"}`);
  if (mode === "export" && file) return exportBacklog(file);
  if (mode === "load" && file) return load(file, rest.includes("--apply"));
  throw new Error("usage: tsx scripts/name-backlog.ts export <out.json> | load [--apply] <in.json>");
}
main().finally(() => prisma.$disconnect());
