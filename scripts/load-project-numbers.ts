// Load reviewed project numbers onto historical projects. Prints the plan; writes
// only with --apply. Safe to rerun: numbers already in place are skipped.
//
//   npx tsx scripts/load-project-numbers.ts [--apply] <project-numbers.csv>
//
// Rows match on Project + FY; only the Project number column is read, and a
// blank one is left alone. "delete" removes the historical project and, by
// cascade, its schedules — rerun Recompute after. Writes to whatever DATABASE_URL points at.

import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { fiscalYear, planProjectNumbers } from "@/lib/historical";
import { readCsv } from "./readCsv";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const [file] = args.filter((a) => !a.startsWith("--"));
  if (!file) throw new Error("usage: tsx scripts/load-project-numbers.ts [--apply] <project-numbers.csv>");
  console.log(`${new URL(process.env.DATABASE_URL ?? "postgresql://missing").hostname} — ${apply ? "APPLYING" : "dry run"}`);

  const projects = (await prisma.project.findMany({ where: { status: "historical" }, select: { id: true, name: true, externalProjectKey: true, projectNumber: true } }))
    .map((p) => ({ ...p, fy: fiscalYear(p.externalProjectKey) }));
  const plan = planProjectNumbers(readCsv(readFileSync(file, "utf8")), projects);
  console.log(`numbers to write: ${plan.updates.length}`);
  console.log(`projects to delete: ${plan.deletes.length}`);
  for (const d of plan.deletes) console.log(`  DELETE ${d.label}`);
  for (const p of plan.problems) console.log(`  SKIPPED ${p}`);
  if (!apply) return;
  await prisma.$transaction([
    ...plan.updates.map((u) => prisma.project.update({ where: { id: u.id }, data: { projectNumber: u.projectNumber } })),
    prisma.project.deleteMany({ where: { id: { in: plan.deletes.map((d) => d.id) }, status: "historical" } }),
  ]);
  console.log("done");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
