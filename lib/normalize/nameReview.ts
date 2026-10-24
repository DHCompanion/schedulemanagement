import { prisma } from "@/lib/db";
import { getDictionary, getKnownScopes } from "@/lib/normalize/normalizationService";
import { suggestScopes } from "@/lib/normalize/suggestScopes";

export interface NameCount {
  /** normalizeName() of the activity name — the dictionary key. */
  normalizedName: string;
  /** The most common spelling, for display and for the mapping itself. */
  sampleName: string;
  /** Distinct projects using the name, historical and live. */
  projects: number;
  sampleProjects: string[];
}

export interface NameReviewRow extends NameCount {
  /** Closest existing standard scope, or "" when nothing overlaps. */
  suggestion: string;
}

/** Names the standard list doesn't cover yet, most widely used first (plan Q61–Q63). */
export function buildNameReview(counts: NameCount[], dict: Map<string, string>, ignored: Set<string>, knownScopes: string[]): NameReviewRow[] {
  return counts
    .filter((c) => !dict.has(c.normalizedName) && !ignored.has(c.normalizedName))
    .map((c) => ({ ...c, suggestion: suggestScopes(c.sampleName, knownScopes, 1)[0] ?? "" }));
}

// The SQL key must equal normalizeName(): trim, lowercase, collapse whitespace.
// Leaves only, from every non-synthetic import, so rough and live schedules count too (Q70).
export async function getNameReview(minProjects: number): Promise<NameReviewRow[]> {
  const counts = await prisma.$queryRaw<NameCount[]>`
    SELECT key AS "normalizedName",
           mode() WITHIN GROUP (ORDER BY name) AS "sampleName",
           count(DISTINCT project_id)::int AS projects,
           (array_agg(DISTINCT project_name))[1:3] AS "sampleProjects"
    FROM (
      SELECT lower(regexp_replace(trim(a.name), '\\s+', ' ', 'g')) AS key, trim(a.name) AS name,
             p.id AS project_id, p.name AS project_name
      FROM "Activity" a
      JOIN "ScheduleImport" i ON i.id = a."scheduleImportId"
      JOIN "Project" p ON p.id = i."projectId"
      WHERE a.type NOT IN ('summary', 'project_summary') AND NOT i."isSynthetic"
    ) n
    WHERE key <> ''
    GROUP BY key
    HAVING count(DISTINCT project_id) >= ${minProjects}
    ORDER BY projects DESC, key`;
  const [dict, ignored, known] = await Promise.all([
    getDictionary(),
    prisma.scopeIgnoredName.findMany({ select: { normalizedName: true } }),
    getKnownScopes(),
  ]);
  return buildNameReview(counts, dict, new Set(ignored.map((i) => i.normalizedName)), known);
}
