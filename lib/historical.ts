import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Backfilled projects are a read-only library (plan Q51): no edits, updates or
// export. Paired with the scope check in every project-scoped API route; it
// lives apart from lib/scope.ts because that module also runs in edge middleware,
// where Prisma can't.
export async function denyIfHistorical(projectId: string): Promise<NextResponse | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (project?.status !== "historical") return null;
  return NextResponse.json({ error: { message: "Historical projects are read-only." } }, { status: 403 });
}

// Skiles' standard market sectors and project types, from Fibery (Database
// Standards/Project Type), plus "Special Procedure (EP, Cath, IR)", "GI/Endoscopy" and
// "Sterile Processing", added here.
// Each type belongs to one sector, so a project's sector
// follows from its type. Stored in Project.sector / Project.buildingType.
export const PROJECT_TYPES = {
  Healthcare: [
    "ASC (Ambulatory Surgery Center)", "Behavioral", "Cancer Center", "Clinic", "Emergency Department",
    "FSED (Freestanding Emergency Department)", "GI/Endoscopy", "Healthcare - Misc.", "Hospital - New Build", "ICU/NICU",
    "Imaging & Radiology", "Lab/Pharmacy", "Med/Surgery", "MEP Upgrade", "MOB (Medical Office Building)",
    "Obstetrics", "OR Suite", "Outpatient Surgery Center", "Patient Care", "POB",
    "Rehab/LTAC (Long Term Acute Care)", "Special Procedure (EP, Cath, IR)", "Sterile Processing", "Vertical Expansion",
  ],
  Institutional: ["Athletic Facilities", "Schools", "Student Housing"],
  Hospitality: ["Hoteling"],
  Commercial: ["Core & Shell", "Kitchen", "Office Building", "Warehouse"],
  "Mission Critical": ["Data Centers"],
  "Higher Education": ["Higher Education - Misc.", "Middle School"],
} as const;
export const SECTORS = Object.keys(PROJECT_TYPES) as (keyof typeof PROJECT_TYPES)[];
export const SECTOR_OF = new Map<string, string>(SECTORS.flatMap((s) => PROJECT_TYPES[s].map((t) => [t, s] as const)));
// Subtypes where a type mixes very different builds (decided 2026-10-26).
export const SUBTYPES: Record<string, readonly string[]> = {
  "Imaging & Radiology": ["MRI", "CT", "X-Ray", "Ultrasound", "Nuclear Medicine", "Mammography", "Fluoroscopy", "Multiple"],
  "Special Procedure (EP, Cath, IR)": ["EP", "Cath", "IR", "Multiple"],
};

/** A subtype for this project type, or null for blank. Throws a user-facing message. */
export function parseSubType(buildingType: string | null, raw: string): string | null {
  const subType = raw.trim() || null;
  if (subType && !SUBTYPES[buildingType ?? ""]?.includes(subType)) throw new Error(`"${subType}" isn't a subtype of ${buildingType ?? "a project with no type"}.`);
  return subType;
}

/** A Skiles project number (5 or 7 digits so far), or null for blank. Throws a user-facing message. */
export function parseProjectNumber(raw: string): string | null {
  const n = raw.trim() || null;
  if (n && !/^[A-Za-z0-9-]{1,20}$/.test(n)) throw new Error(`"${n}" isn't a project number: letters, digits and dashes only.`);
  return n;
}

/** Project numbers to write from the review sheet (Project / FY / Project number). Blank rows and numbers already set are skipped. */
export function planProjectNumbers(rows: Record<string, string>[], projects: { id: string; name: string; fy: number | null; projectNumber: string | null }[]) {
  const updates: { id: string; projectNumber: string }[] = [];
  const problems: string[] = [];
  for (const r of rows) {
    if (!r["Project number"]?.trim()) continue;
    const label = `${r.Project} (FY${r.FY})`;
    const match = projects.filter((p) => p.name === r.Project && String(p.fy ?? "") === r.FY);
    if (match.length !== 1) { problems.push(`${label}: ${match.length} projects match`); continue; }
    try {
      const projectNumber = parseProjectNumber(r["Project number"])!;
      if (match[0].projectNumber !== projectNumber) updates.push({ id: match[0].id, projectNumber });
    } catch (e) {
      problems.push(`${label}: ${(e as Error).message}`);
    }
  }
  return { updates, problems };
}

// As-built and baseline have to come from the data; review can only demote.
export const TIER_OVERRIDES = ["rough", "junk"] as const;

export interface ProjectDetails { sector: string | null; buildingType: string | null; sizeSqFt: number | null }

/** Validates submitted details against the lists; the sector comes from the project type. Blanks become null. Throws a user-facing message. */
export function parseDetails(raw: { sector?: string; buildingType?: string; sizeSqFt?: string }): ProjectDetails {
  const buildingType = raw.buildingType?.trim() || null;
  const size = raw.sizeSqFt?.replace(/,/g, "").trim() || null;
  const given = raw.sector?.trim() || null;
  if (buildingType && !SECTOR_OF.has(buildingType)) throw new Error(`Unknown project type "${buildingType}".`);
  const sector = buildingType ? SECTOR_OF.get(buildingType)! : given;
  if (given && given !== sector) throw new Error(`"${buildingType}" is a ${sector} project type, not ${given}.`);
  if (sector && !(SECTORS as string[]).includes(sector)) throw new Error(`Unknown sector "${sector}".`);
  if (size && !/^\d+$/.test(size)) throw new Error(`Size "${raw.sizeSqFt}" isn't a whole number of square feet.`);
  return { sector, buildingType, sizeSqFt: size ? Number(size) : null };
}

/** Fiscal year from the backfill key `backfill:FY<year>:<name>` (plan Phase 3). */
export function fiscalYear(externalProjectKey: string | null): number | null {
  const fy = externalProjectKey?.match(/^backfill:FY(\d{4}):/)?.[1];
  return fy ? Number(fy) : null;
}
