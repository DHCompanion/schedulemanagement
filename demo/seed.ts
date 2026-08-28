import { readFileSync } from "node:fs";
import { prisma } from "../lib/db";
import { commitImport } from "../lib/import/commitImport";
import { finalizeUpdate, getOrCreateDraft, saveEntries } from "../lib/updates/updateService";
import { buildMspdi, dayAt } from "./mspdi";

// --- shared helper block (anchorMonday, dateAt, loadStory, loadIds), duplicated verbatim
// across the demo seeders per plan (not imported across repos). requireDemoUrl is the
// controller-ruling variant: an explicit DEMO_DB_HOSTS allowlist (Neon endpoint hostnames
// are random words, not "demo"-branded) copied from the OS seedOs.ts guard, instead of the
// plan header's "hostname contains demo" check.
export function anchorMonday(now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}
export function dateAt(offsetDays: number, anchor: Date = anchorMonday()): string {
  const d = new Date(anchor); d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
export function requireDemoUrl(url: string | undefined, env: NodeJS.ProcessEnv = process.env): void {
  const hostname = url ? new URL(url).hostname : "";
  if (env.SKILES_DEMO_DB_OK === "1" && /^(127\.|localhost$)/.test(hostname)) return;
  // A Neon branch has one endpoint reachable as <ep-id>.<region> (direct) or <ep-id>-pooler.<region> (pooled).
  const canonical = (h: string) => h.replace(/-pooler(?=\.)/, "");
  const allowed = (env.DEMO_DB_HOSTS ?? "").split(",").map((h) => canonical(h.trim())).filter(Boolean);
  if (!url || !allowed.includes(canonical(hostname))) throw new Error(`DATABASE_URL host "${hostname}" is not in DEMO_DB_HOSTS (demo/.env.demo) — refusing to seed a non-demo database (or set SKILES_DEMO_DB_OK=1 against a local host)`);
}
export function loadStory<T = unknown>(): T {
  return JSON.parse(readFileSync(process.env.DEMO_STORY_PATH ?? "../skiles-group-connect-v1/.claude/worktrees/demo/demo/story.json", "utf8")) as T;
}
export function loadIds<T = unknown>(): T {
  return JSON.parse(readFileSync(process.env.DEMO_IDS_PATH ?? "../skiles-group-connect-v1/.claude/worktrees/demo/demo/ids.json", "utf8")) as T;
}

type Ids = { anchor: string; projects: Record<string, number>; people: Record<string, { id: number; name: string }>; tradePartners: Record<string, { id: number; name: string }>; disciplines: Record<string, { id: number; name: string; division: string }> };
type Story = Parameters<typeof buildMspdi>[0] & {
  project: { number: string; name: string; client: string; superintendentKey: string; statusOffsets: number[] };
  disciplines: { key: string; osName: string; csi: string; scope: string }[];
  tradePartners: { key: string; name: string; disciplineKeys: string[]; projectNumbers: string[] }[];
  activities: (Parameters<typeof buildMspdi>[0]["activities"][number] & { key: string; scopeKey: string | null; partnerKey: string | null })[];
};

async function main() {
  requireDemoUrl(process.env.DATABASE_URL);
  const story = loadStory<Story>(); const ids = loadIds<Ids>();
  const anchor = new Date(`${ids.anchor}T00:00:00Z`);
  const osProjectId = ids.projects[story.project.number];
  const superId = ids.people[story.project.superintendentKey].id;

  const project = await prisma.project.upsert({ where: { osProjectId }, update: { name: story.project.name }, create: { osProjectId, name: story.project.name, client: story.project.client, sector: "Healthcare", externalProjectGuid: `DEMO-${story.project.number}` } });

  // Imports: skip if this seeder already loaded them (same fileName + project).
  const existing = await prisma.scheduleImport.count({ where: { projectId: project.id, fileName: { startsWith: "demo-" } } });
  if (existing === 0) {
    await commitImport({ projectId: project.id, fileName: "demo-baseline.xml", xml: buildMspdi(story, anchor, null), isBaseline: true, importedBy: "demo", personId: superId });
    for (const off of story.project.statusOffsets) {
      await commitImport({ projectId: project.id, fileName: `demo-status-${off}.xml`, xml: buildMspdi(story, anchor, off), isBaseline: false, importedBy: "demo", personId: superId, statusDateOverride: `${dateAt(off, anchor)}T17:00:00` });
    }
  }

  // Learning dictionaries (global): one scope entry per scoped leaf name, one trade entry per scope.
  // Indexed on both discipline.key and discipline.scope: story.json's activities[].scopeKey is
  // inconsistent between the two (e.g. "sprinkler"/"glazing" activities carry the scope string
  // "fire sprinkler"/"exterior windows" rather than the discipline key) — no collisions in practice.
  const scopeByKey = new Map(story.disciplines.flatMap((d) => [[d.key, d], [d.scope, d]] as const));
  for (const a of story.activities) {
    if (a.summary || !a.scopeKey) continue;
    const d = scopeByKey.get(a.scopeKey)!;
    await prisma.scopeDictionaryEntry.upsert({ where: { normalizedName: a.name.trim().toLowerCase().replace(/\s+/g, " ") }, update: {}, create: { normalizedName: a.name.trim().toLowerCase().replace(/\s+/g, " "), canonicalScope: d.scope, createdBy: "demo" } });
  }
  for (const d of story.disciplines) {
    const os = ids.disciplines[d.key];
    await prisma.tradeDictionaryEntry.upsert({ where: { canonicalScope: d.scope }, update: { osDisciplineId: os.id, disciplineName: os.name }, create: { canonicalScope: d.scope, osDisciplineId: os.id, disciplineName: os.name, createdBy: "demo", personId: superId } });
  }

  // Partner roster (as the OS launch would cache it) + per-discipline assignment.
  for (const p of story.tradePartners.filter((p) => p.projectNumbers.includes(story.project.number))) {
    const os = ids.tradePartners[p.key];
    const disciplines = p.disciplineKeys.map((k) => ids.disciplines[k]).map((d) => ({ id: d.id, name: d.name, division: d.division }));
    await prisma.osTradePartner.upsert({ where: { projectId_osPartnerId: { projectId: project.id, osPartnerId: os.id } }, update: { name: os.name, disciplines }, create: { projectId: project.id, osPartnerId: os.id, name: os.name, disciplines } });
    for (const d of disciplines) {
      await prisma.projectTradeAssignment.upsert({ where: { projectId_osDisciplineId: { projectId: project.id, osDisciplineId: d.id } }, update: { osPartnerId: os.id, partnerName: os.name }, create: { projectId: project.id, osDisciplineId: d.id, osPartnerId: os.id, partnerName: os.name, personId: superId } });
    }
  }

  // One finalized weekly update as of last Friday, if none exists.
  if ((await prisma.progressUpdate.count({ where: { projectId: project.id, state: "finalized" } })) === 0) {
    const asOf = dateAt(-3, anchor);
    const draft = await getOrCreateDraft(project.id, asOf, 3, superId);
    const entries = story.activities.filter((a) => !a.summary && a.startOffset < -3).map((a) => {
      const done = a.startOffset + a.durationDays <= -3;
      return { activityExternalUid: a.uid, canonicalActivityKey: a.key, status: done ? "complete" : "in_progress", actualStart: dateAt(a.startOffset, anchor), actualFinish: done ? dateAt(a.startOffset + a.durationDays, anchor) : null, percentComplete: done ? 100 : 50, note: null };
    });
    await saveEntries(draft.id, entries);
    await finalizeUpdate(draft.id);
  }
  console.log(`[schedule demo] project ${project.id} (os ${osProjectId}); imports=${await prisma.scheduleImport.count({ where: { projectId: project.id } })}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
