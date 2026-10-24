// One-off: import a reviewed backfill manifest. Each kept row goes through the normal
// import path (commitImport), into a "historical" project per manifest group, oldest
// save first. Resumable: files already imported into their project are skipped.
// Prints and writes each file's tier and logic score for calibration.
// Throwaway; delete after the historical backfill (plan Phase 6).
//
//   npx tsx scripts/backfill.ts <manifest.csv> <xml-dir> <fiscal-year>
//
// Projects belong to the fiscal year they were created in, so the same name in two
// years is two projects: the key is backfill:FY<year>:<name>.
//
// An optional <year>-projects.csv beside the manifest (columns project, sector,
// buildingType, sizeSqFt) sets each project's details, on reruns too.
//
// Writes to whatever DATABASE_URL points at. Anything but a local database needs
// BACKFILL_DB_OK=1 — this creates real projects — and AWS_BUCKET, so originals
// land in S3 like any other import.

import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { prisma } from "@/lib/db";
import { commitImport } from "@/lib/import/commitImport";
import { getImportQuality } from "@/lib/health/healthService";
import { backfillPlan, projectDetails, readCsv } from "./manifestRules";
import type { ProjectDetails } from "@/lib/historical";

function requireSafeDatabase(): void {
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://missing").hostname;
  if (/^(localhost|127\.)/.test(host)) return;
  if (process.env.BACKFILL_DB_OK !== "1") throw new Error(`DATABASE_URL points at ${host}. Set BACKFILL_DB_OK=1 to backfill a non-local database.`);
  // Without a bucket the originals go to an in-memory store, and the rows would
  // point at S3 objects that were never written.
  if (!process.env.AWS_BUCKET) throw new Error("Set AWS_BUCKET (and the AWS keys) so the original files are stored.");
}

function csv(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const [manifestPath, xmlDir, fiscalYear] = process.argv.slice(2);
  if (!manifestPath || !xmlDir || !/^\d{4}$/.test(fiscalYear ?? "")) throw new Error("usage: tsx scripts/backfill.ts <manifest.csv> <xml-dir> <fiscal-year>");
  requireSafeDatabase();

  const read = (path: string) => readCsv(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  const plan = backfillPlan(read(manifestPath));
  const detailsPath = manifestPath.replace(/-manifest\.csv$/i, "-projects.csv");
  const details = detailsPath !== manifestPath && existsSync(detailsPath) ? projectDetails(read(detailsPath)) : new Map<string, ProjectDetails>();
  const results: string[] = ["project,file,status,tier,checksPassed,noPredecessor,noSuccessor,reasons"];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const { project, files } of plan) {
    const externalProjectKey = `backfill:FY${fiscalYear}:${project}`;
    const existing = await prisma.project.findFirst({ where: { externalProjectKey } });
    const { id: projectId } = existing ?? (await prisma.project.create({ data: { name: project, externalProjectKey, status: "historical" } }));
    const d = details.get(project);
    if (d) await prisma.project.update({ where: { id: projectId }, data: d });
    const done = new Map((await prisma.scheduleImport.findMany({ where: { projectId }, select: { id: true, fileHash: true } })).map((i) => [i.fileHash, i.id]));

    for (const f of files) {
      const xmlName = f.file.replace(/\.[^.]+$/, ".xml");
      const record = (status: string, q?: Awaited<ReturnType<typeof getImportQuality>>) => {
        const pct = (n: number) => `${Math.round(n * 100)}%`;
        results.push(
          [project, f.file, status, q?.tier ?? "", q ? `${q.logic.passed}/${q.logic.total}` : "", q ? pct(q.logic.noPredecessorPct) : "", q ? pct(q.logic.noSuccessorPct) : "", q?.reasons.join(" | ") ?? ""]
            .map(csv)
            .join(","),
        );
        process.stdout.write(`${status.padEnd(8)} ${(q?.tier ?? "").padEnd(9)} ${project} / ${basename(f.file)}\n`);
      };
      try {
        const xml = readFileSync(join(xmlDir, xmlName), "utf8");
        const doneId = done.get(crypto.createHash("sha256").update(xml).digest("hex"));
        if (doneId) {
          skipped++;
          record("skipped", await getImportQuality(doneId));
          continue;
        }
        const { id } = await commitImport({ projectId, fileName: basename(xmlName), xml, isBaseline: f.isBaseline, importedBy: "backfill" });
        if (f.tierOverride) await prisma.scheduleImport.update({ where: { id }, data: { tierOverride: f.tierOverride } });
        imported++;
        record("imported", await getImportQuality(id));
      } catch (e) {
        failed++;
        record(`failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const resultsPath = manifestPath.replace(/\.csv$/i, "") + "-results.csv";
  writeFileSync(resultsPath, results.join("\n") + "\n");
  process.stdout.write(`\n${plan.length} projects: ${imported} imported, ${skipped} already there, ${failed} failed → ${resultsPath}\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  await prisma.$disconnect();
  process.exit(1);
});
