// Apply reviewed naming spreadsheets to the dictionary. Prints the plan; writes
// only with --apply. Safe to rerun: what is already in place is skipped.
//
//   npx tsx scripts/apply-naming-review.ts [--apply] [--approve-new] <sheet.csv>...
//
// naming-dictionary-review.csv (Activity name / Action / Approved name) sets the
// whole standard list: merges re-point, retire deletes the entry, ignore ignores.
// A review batch (Current name / Standard name) maps each name to an approved
// name, or to a keyword: ignore, procurement, coarse, coarse: A + B. A name not
// on the list is reported; --approve-new adds it instead. Blank rows are skipped.
//
// Writes to whatever DATABASE_URL points at.

import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { getKnownScopes } from "@/lib/normalize/normalizationService";
import { applyNamingPlan, listChanges, planNamingSheet } from "@/lib/normalize/namingSheet";
import { readCsv } from "./manifestRules";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const approveNew = args.includes("--approve-new");
  const files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) throw new Error("usage: tsx scripts/apply-naming-review.ts [--apply] [--approve-new] <sheet.csv>...");
  console.log(`${new URL(process.env.DATABASE_URL ?? "postgresql://missing").hostname} — ${apply ? "APPLYING" : "dry run"}`);

  // Each file sees the list as the previous one left it — in a dry run too.
  let approved = await getKnownScopes();
  for (const file of files) {
    const plan = planNamingSheet(readCsv(readFileSync(file, "utf8").replace(/^\uFEFF/, "")), approved, approveNew);
    const kinds = plan.ops.reduce<Record<string, number>>((n, o) => ({ ...n, [o.kind]: (n[o.kind] ?? 0) + 1 }), {});
    console.log(`\n${file}\n  rows to write: ${JSON.stringify(kinds)}`);
    if (plan.standard) {
      const change = listChanges(approved, plan.standard, []);
      console.log(`  standard list: ${plan.standard.length} names (+${change.add.length} / -${change.remove.length})`);
    }
    if (plan.added.length) console.log(`  new standard names: ${plan.added.join(", ")}`);
    for (const p of plan.problems) console.log(`  SKIPPED ${p}`);
    if (apply) console.log(`  done: ${JSON.stringify(await applyNamingPlan(plan))}`);
    approved = apply ? await getKnownScopes() : (plan.standard ?? [...approved, ...plan.added]);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
