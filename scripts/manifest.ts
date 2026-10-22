// One-off: write the backfill manifest — one CSV row per source schedule, with its
// proposed project group and keep/skip (scripts/manifestRules.ts). Admins correct the
// CSV; the backfill imports only keep=yes rows. Throwaway; delete after Phase 6.
//
//   npx tsx scripts/manifest.ts <mpp-dir> <xml-dir> <out.csv>
//
// Review loop: fill the `project` column for rows whose grouping is wrong, save, and
// rerun with the same <out.csv> — your project names are read back, rows are regrouped
// and keep/skip is recomputed per project.

import crypto from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseMspXml } from "@/lib/msp/parseMspXml";
import { isLeafActive } from "@/lib/msp/types";
import { placeFiles, type ManifestFile } from "./manifestRules";

interface Row extends ManifestFile {
  kind: "master" | "short-term";
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

/** Minimal CSV reader for the file this script writes (quoted fields, doubled quotes). */
function readCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

// Short-term working schedules: imported for their task names, never benchmarked (plan Q48).
const SHORT_TERM = /pull plan|look ?-?ahead/i;

function readRow(mppDir: string, xmlDir: string, mppPath: string, projectByFile: Map<string, string>): Row {
  const file = relative(mppDir, mppPath);
  const project = projectByFile.get(file) || null;
  const sha256 = crypto.createHash("sha256").update(readFileSync(mppPath)).digest("hex");
  const kindOf = (title: string) => (SHORT_TERM.test(file) || SHORT_TERM.test(title) ? "short-term" : "master") as Row["kind"];
  const empty = { project, kind: kindOf(""), title: "", projectStart: "", projectFinish: "", statusDate: "", leaves: 0, relationships: 0, withActuals: 0, creationDate: null, lastSaved: null };
  const xmlPath = join(xmlDir, file.replace(/\.[^.]+$/, ".xml"));
  if (!existsSync(xmlPath)) return { ...empty, file, sha256, error: "not converted (see _failed.txt)" };
  try {
    const parsed = parseMspXml(readFileSync(xmlPath, "utf8"));
    const leaves = parsed.activities.filter(isLeafActive);
    return {
      file,
      sha256,
      project,
      kind: kindOf(parsed.header.titleFromFile),
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

  const previous = existsSync(outCsv) ? readCsv(readFileSync(outCsv, "utf8")) : [];
  const projectByFile = new Map(previous.filter((r) => r.project).map((r) => [r.file, r.project]));
  const rows = walk(mppDir).filter((p) => /\.mpp$/i.test(p)).map((p) => readRow(mppDir, xmlDir, p, projectByFile));
  const placed = placeFiles(rows);
  const columns = ["project", "group", "keep", "reason", "checkGrouping", "kind", "file", "title", "creationDate", "lastSaved", "projectStart", "projectFinish", "statusDate", "leaves", "relationships", "withActuals", "sha256"] as const;
  const lines = rows
    .map((r) => ({ ...r, ...placed.get(r.file)!, project: r.project ?? "" }))
    .sort((a, b) => a.group.localeCompare(b.group) || (a.lastSaved ?? "").localeCompare(b.lastSaved ?? ""))
    .map((r) => columns.map((c) => csv(c === "keep" ? (r.keep ? "yes" : "no") : (r[c] ?? ""))).join(","));
  writeFileSync(outCsv, [columns.join(","), ...lines].join("\n") + "\n");

  const kept = [...placed.values()].filter((p) => p.keep).length;
  const groups = new Set([...placed.values()].map((p) => p.group).filter(Boolean));
  const check = new Set([...placed.values()].filter((p) => p.checkGrouping).map((p) => p.group));
  const shortTerm = rows.filter((r) => r.kind === "short-term").length;
  process.stdout.write(`${rows.length} files → ${groups.size} projects, ${kept} kept, ${check.size} groups to check, ${shortTerm} short-term, ${rows.filter((r) => r.error).length} errors\n`);
}

main();
