// One-off: write the backfill manifest — one CSV row per source schedule, with its
// proposed project group and keep/skip (scripts/manifestRules.ts). Admins correct the
// CSV; the backfill imports only keep=yes rows. Throwaway; delete after Phase 6.
//
//   npx tsx scripts/manifest.ts <mpp-dir> <xml-dir> <out.csv>
//
// Review loop: for a row in the wrong group, type the right job in `project` — an
// existing `group` name to join that job, or a new name to split it out. Save and
// rerun with the same <out.csv> — your project names are read back, rows are regrouped
// and keep/skip is recomputed per project.

import crypto from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseMspXml } from "@/lib/msp/parseMspXml";
import { isLeafActive } from "@/lib/msp/types";
import { placeFiles, readCsv, type ManifestFile } from "./manifestRules";

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

// Short-term working schedules: imported for their task names, never benchmarked (plan Q48).
const SHORT_TERM = /pull plan|look ?-?ahead/i;

interface Review { project: string | null; reviewerSkip: boolean; kind: string }

function readRow(mppDir: string, xmlDir: string, mppPath: string, reviews: Map<string, Review>): Row {
  const file = relative(mppDir, mppPath);
  const review = reviews.get(file);
  const project = review?.project ?? null;
  const reviewerSkip = review?.reviewerSkip ?? false;
  const sha256 = crypto.createHash("sha256").update(readFileSync(mppPath)).digest("hex");
  const kindOf = (title: string): Row["kind"] => {
    if (review?.kind === "master" || review?.kind === "short-term") return review.kind;
    return SHORT_TERM.test(file) || SHORT_TERM.test(title) ? "short-term" : "master";
  };
  const empty = { project, reviewerSkip, kind: kindOf(""), title: "", projectStart: "", projectFinish: "", statusDate: "", leaves: 0, relationships: 0, withActuals: 0, creationDate: null, lastSaved: null };
  const xmlPath = join(xmlDir, file.replace(/\.[^.]+$/, ".xml"));
  if (!existsSync(xmlPath)) return { ...empty, file, sha256, error: "not converted (see _failed.txt)" };
  try {
    const parsed = parseMspXml(readFileSync(xmlPath, "utf8"));
    const leaves = parsed.activities.filter(isLeafActive);
    return {
      file,
      sha256,
      project,
      reviewerSkip,
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

  // Spreadsheet apps add a BOM and change case ("No", "TRUE"); normalise both.
  const previous = existsSync(outCsv) ? readCsv(readFileSync(outCsv, "utf8").replace(/^\uFEFF/, "")) : [];
  const reviews = new Map<string, Review>(
    previous.map((r) => [
      r.file,
      {
        project: r.project?.trim() || null,
        // A "no" the script didn't decide is the reviewer's; the script's own skips get recomputed.
        reviewerSkip: r.keep?.trim().toLowerCase() === "no" && !/^(duplicate of|superseded|conversion failed)/.test(r.reason ?? ""),
        kind: r.kind?.trim().toLowerCase() ?? "",
      },
    ]),
  );
  // A job with every row at "no" was dropped by the reviewer — otherwise its script-skipped
  // rows would be promoted to earliest/latest on the rerun and the job would come back.
  const byGroup = new Map<string, Record<string, string>[]>();
  for (const r of previous) if (r.group) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r]);
  for (const members of byGroup.values()) {
    const dropped = members.every((r) => r.keep?.trim().toLowerCase() === "no") && members.some((r) => reviews.get(r.file)?.reviewerSkip);
    if (dropped) for (const r of members) reviews.get(r.file)!.reviewerSkip = true;
  }
  const rows = walk(mppDir).filter((p) => /\.mpp$/i.test(p)).map((p) => readRow(mppDir, xmlDir, p, reviews));
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
