// One-off: write the backfill manifest — one CSV row per source schedule, with its
// proposed project group and keep/skip (scripts/manifestRules.ts). Admins correct the
// CSV; the backfill imports only keep=yes rows. Throwaway; delete after Phase 6.
//
//   npx tsx scripts/manifest.ts <mpp-dir> <xml-dir> <out.csv>

import crypto from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseMspXml } from "@/lib/msp/parseMspXml";
import { isLeafActive } from "@/lib/msp/types";
import { placeFiles, type ManifestFile } from "./manifestRules";

interface Row extends ManifestFile {
  title: string;
  projectStart: string;
  projectFinish: string;
  statusDate: string;
  leaves: number;
  relationships: number;
  withActuals: number;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function csv(value: string | number | boolean): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function readRow(mppDir: string, xmlDir: string, mppPath: string): Row {
  const file = relative(mppDir, mppPath);
  const sha256 = crypto.createHash("sha256").update(readFileSync(mppPath)).digest("hex");
  const empty = { title: "", projectStart: "", projectFinish: "", statusDate: "", leaves: 0, relationships: 0, withActuals: 0, creationDate: null, lastSaved: null };
  const xmlPath = join(xmlDir, file.replace(/\.[^.]+$/, ".xml"));
  if (!existsSync(xmlPath)) return { ...empty, file, sha256, error: "not converted (see _failed.txt)" };
  try {
    const parsed = parseMspXml(readFileSync(xmlPath, "utf8"));
    const leaves = parsed.activities.filter(isLeafActive);
    return {
      file,
      sha256,
      error: null,
      title: parsed.header.titleFromFile,
      creationDate: parsed.header.rawProps.CreationDate ?? null,
      lastSaved: parsed.header.rawProps.LastSaved ?? null,
      projectStart: parsed.header.projectStart ?? "",
      projectFinish: parsed.header.projectFinish ?? "",
      statusDate: parsed.header.statusDate ?? "",
      leaves: leaves.length,
      relationships: parsed.relationships.length,
      withActuals: leaves.filter((a) => a.actualStart || a.actualFinish).length,
    };
  } catch (e) {
    return { ...empty, file, sha256, error: e instanceof Error ? e.message : "unparseable XML" };
  }
}

function main() {
  const [mppDir, xmlDir, outCsv] = process.argv.slice(2);
  if (!mppDir || !xmlDir || !outCsv) throw new Error("usage: tsx scripts/manifest.ts <mpp-dir> <xml-dir> <out.csv>");

  const rows = walk(mppDir).filter((p) => /\.mpp$/i.test(p)).map((p) => readRow(mppDir, xmlDir, p));
  const placed = placeFiles(rows);
  const columns = ["group", "keep", "reason", "checkGrouping", "file", "title", "creationDate", "lastSaved", "projectStart", "projectFinish", "statusDate", "leaves", "relationships", "withActuals", "sha256"] as const;
  const lines = rows
    .map((r) => ({ ...r, ...placed.get(r.file)! }))
    .sort((a, b) => a.group.localeCompare(b.group) || (a.lastSaved ?? "").localeCompare(b.lastSaved ?? ""))
    .map((r) => columns.map((c) => csv(c === "keep" ? (r.keep ? "yes" : "no") : (r[c] ?? ""))).join(","));
  writeFileSync(outCsv, [columns.join(","), ...lines].join("\n") + "\n");

  const kept = [...placed.values()].filter((p) => p.keep).length;
  const groups = new Set([...placed.values()].map((p) => p.group).filter(Boolean));
  const check = new Set([...placed.values()].filter((p) => p.checkGrouping).map((p) => p.group));
  process.stdout.write(`${rows.length} files → ${groups.size} projects, ${kept} kept, ${check.size} groups to check, ${rows.filter((r) => r.error).length} errors\n`);
}

main();
