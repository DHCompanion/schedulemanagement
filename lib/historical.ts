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
// Standards/Project Type), plus "Special Procedure (EP, Cath, IR)", added here.
// Each type belongs to one sector, so a project's sector
// follows from its type. Stored in Project.sector / Project.buildingType.
export const PROJECT_TYPES = {
  Healthcare: [
    "ASC (Ambulatory Surgery Center)", "Behavioral", "Cancer Center", "Clinic", "Emergency Department",
    "FSED (Freestanding Emergency Department)", "Healthcare - Misc.", "Hospital - New Build", "ICU/NICU",
    "Imaging & Radiology", "Lab/Pharmacy", "Med/Surgery", "MEP Upgrade", "MOB (Medical Office Building)",
    "Obstetrics", "OR Suite", "Outpatient Surgery Center", "Patient Care", "POB",
    "Rehab/LTAC (Long Term Acute Care)", "Special Procedure (EP, Cath, IR)", "Vertical Expansion",
  ],
  Institutional: ["Athletic Facilities", "Schools", "Student Housing"],
  Hospitality: ["Hoteling"],
  Commercial: ["Core & Shell", "Kitchen", "Office Building", "Warehouse"],
  "Mission Critical": ["Data Centers"],
  "Higher Education": ["Higher Education - Misc.", "Middle School"],
} as const;
export const SECTORS = Object.keys(PROJECT_TYPES) as (keyof typeof PROJECT_TYPES)[];
const SECTOR_OF = new Map<string, string>(SECTORS.flatMap((s) => PROJECT_TYPES[s].map((t) => [t, s] as const)));
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
