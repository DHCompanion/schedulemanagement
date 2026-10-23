// Pure rules for the backfill manifest: which files belong to the same project,
// and which versions of each project to keep (plan Q42: earliest, latest, and the
// last save of each month between). Throwaway backfill tooling; delete after Phase 6.

export interface ManifestFile {
  file: string;
  title: string;
  /** Reviewer's project name from a previous manifest; overrides the proposed grouping. */
  project: string | null;
  /** Reviewer set keep=no: never imported, and not considered when picking versions. */
  reviewerSkip: boolean;
  sha256: string;
  /** Header CreationDate — survives every incremental save of the same file. */
  creationDate: string | null;
  /** Header LastSaved — orders the versions. */
  lastSaved: string | null;
  error: string | null;
}

export interface Placement {
  /** Proposed project name: the reviewer's, else the latest file's title. */
  group: string;
  keep: boolean;
  reason: string;
  /** The group's files have dissimilar names — a person (or the local model) should confirm the grouping. */
  checkGrouping: boolean;
}

const NOISE = new Set(["schedule", "update", "updated", "rev", "revised", "copy", "draft", "final", "v", "the", "and"]);

/** File name reduced to its project words: no extension, dates, numbers or filler. */
export function nameStem(file: string): string {
  // Parentheticals are sync noise: "(conflict copy from someone@…)", "(2)".
  const base = file.split("/").pop()!.replace(/\.[^.]+$/, "").replace(/\(.*?\)/g, " ").toLowerCase();
  return base
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !NOISE.has(w))
    .join(" ");
}

function jaccard(a: string, b: string): number {
  const x = new Set(a.split(" ").filter(Boolean));
  const y = new Set(b.split(" ").filter(Boolean));
  if (x.size === 0 && y.size === 0) return 1;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

// ponytail: fixed cut-off; tune once the 2020 manifest has been reviewed.
const SAME_NAME_JACCARD = 0.3;

function groupKey(f: ManifestFile): string {
  if (f.project) return `project ${f.project}`;
  // CreationDate to the minute is shared by every save of one file, and rarely by different jobs.
  // Without it, fall back to the name — weaker, so those groups always get checked.
  return f.creationDate ? `created ${f.creationDate.slice(0, 16)}` : `name ${nameStem(f.file)}`;
}

/**
 * A reviewer joins a row to another job by typing that job's proposed group name
 * into `project`. Rows left blank in that job then follow it, so the name alone merges.
 */
export function placeFiles(files: ManifestFile[]): Map<string, Placement> {
  const names = new Set(files.map((f) => f.project).filter(Boolean));
  if (names.size === 0) return placeGroups(files);
  const proposed = placeGroups(files.map((f) => ({ ...f, project: null })));
  return placeGroups(files.map((f) => {
    const label = proposed.get(f.file)?.group;
    return !f.project && label && names.has(label) ? { ...f, project: label } : f;
  }));
}

function placeGroups(files: ManifestFile[]): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const groups = new Map<string, ManifestFile[]>();
  for (const f of files) {
    if (f.error) {
      out.set(f.file, { group: "", keep: false, reason: `conversion failed: ${f.error}`, checkGrouping: false });
      continue;
    }
    const key = groupKey(f);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  for (const [key, all] of groups) {
    // A shared creation date with unrelated names means a job was started from a copy of
    // another job's file (FY2022+ is full of these): split it by name. The copies keep the
    // template's title too, so name the pieces after their latest file instead.
    const pieces = key.startsWith("created ") ? splitByName(all) : [all];
    for (const members of pieces) placeGroup(key, members, pieces.length > 1, out);
  }
  return out;
}

/**
 * Single-linkage clusters of files whose name stems look alike. Generic names
 * ("Project1", "Schedule DD") say nothing about the job, so they stay with the biggest cluster.
 */
function splitByName(files: ManifestFile[]): ManifestFile[][] {
  const generic = (f: ManifestFile) => nameStem(f.file).split(" ").filter(Boolean).length <= 1;
  const clusters: ManifestFile[][] = [];
  for (const f of files.filter((x) => !generic(x))) {
    const stem = nameStem(f.file);
    const near = clusters.filter((c) => c.some((m) => jaccard(nameStem(m.file), stem) >= SAME_NAME_JACCARD));
    clusters.splice(0, clusters.length, ...clusters.filter((c) => !near.includes(c)), [...near.flat(), f]);
  }
  const rest = files.filter(generic);
  if (clusters.length === 0) return [rest];
  clusters.sort((a, b) => b.length - a.length)[0].push(...rest);
  return clusters;
}

function placeGroup(key: string, members: ManifestFile[], split: boolean, out: Map<string, Placement>): void {
  const stems = [...new Set(members.map((m) => nameStem(m.file)))];
  const dissimilar = stems.some((a) => stems.some((b) => jaccard(a, b) < SAME_NAME_JACCARD));
  const reviewed = key.startsWith("project ");
  const checkGrouping = !reviewed && (key.startsWith("name ") || dissimilar || split);
  const sorted = [...members].sort((a, b) => (a.lastSaved ?? "").localeCompare(b.lastSaved ?? "") || a.file.localeCompare(b.file));
  const latest = sorted[sorted.length - 1];
  const fileName = latest.file.split("/").pop()!.replace(/\.[^.]+$/, "");
  const label = reviewed ? key.slice("project ".length) : (split || /[\\/]/.test(latest.title) ? fileName : latest.title) || nameStem(latest.file);
  const place = (f: ManifestFile, keep: boolean, reason: string) => out.set(f.file, { group: label, keep, reason, checkGrouping });

  const seen = new Map<string, string>();
  const unique: ManifestFile[] = [];
  for (const f of sorted) {
    if (f.reviewerSkip) { place(f, false, "skipped by reviewer"); continue; }
    const dup = seen.get(f.sha256);
    if (dup) place(f, false, `duplicate of ${dup}`);
    else {
      seen.set(f.sha256, f.file);
      unique.push(f);
    }
  }

  // Last save of each calendar month wins its month; the first and last versions always stay.
  const lastOfMonth = new Map<string, ManifestFile>();
  for (const f of unique) lastOfMonth.set((f.lastSaved ?? "").slice(0, 7), f);
  const monthly = new Set(lastOfMonth.values());
  unique.forEach((f, i) => {
    if (i === 0) place(f, true, unique.length === 1 ? "only version" : "earliest version");
    else if (i === unique.length - 1) place(f, true, "latest version");
    else if (monthly.has(f)) place(f, true, `last save of ${(f.lastSaved ?? "").slice(0, 7)}`);
    else place(f, false, "superseded within its month");
  });
}

/** Minimal CSV reader for the file this script writes (quoted fields, doubled quotes). */
export function readCsv(text: string): Record<string, string>[] {
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

export interface BackfillFile {
  file: string;
  isBaseline: boolean;
  /** Short-term schedules feed names only (plan Q48). */
  tierOverride: "rough" | null;
}

/** Reviewed manifest → per-project import order: kept rows, oldest save first, earliest master file as the baseline. */
export function backfillPlan(rows: Record<string, string>[]): { project: string; files: BackfillFile[] }[] {
  const byProject = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    if (r.keep?.trim().toLowerCase() !== "yes" || !r.group) continue;
    byProject.set(r.group, [...(byProject.get(r.group) ?? []), r]);
  }
  return [...byProject].map(([project, members]) => {
    const sorted = [...members].sort((a, b) => (a.lastSaved ?? "").localeCompare(b.lastSaved ?? ""));
    const baseline = sorted.find((r) => r.kind !== "short-term");
    return {
      project,
      files: sorted.map((r) => ({ file: r.file, isBaseline: r === baseline, tierOverride: r.kind === "short-term" ? "rough" : null })),
    };
  });
}
