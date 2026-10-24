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

// Fixed lists so benchmarks group cleanly (plan Phase 4). Nearly every project is
// healthcare, so "building type" here is really the kind of project.
export const SECTORS = ["Healthcare", "Education", "Commercial", "Community", "Other"] as const;
export const BUILDING_TYPES = [
  "Ground-up building",
  "Clinic / MOB finish-out",
  "ASC",
  "Cath / IR / EP",
  "Imaging",
  "Surgery",
  "Emergency department",
  "Patient units",
  "Pharmacy",
  "Lab",
  "Support / admin / food service",
  "MEP / infrastructure",
  "Exterior / site",
  "Other",
] as const;
// As-built and baseline have to come from the data; review can only demote.
export const TIER_OVERRIDES = ["rough", "junk"] as const;

export interface ProjectDetails { sector: string | null; buildingType: string | null; sizeSqFt: number | null }

/** Validates submitted details against the lists; blanks become null. Throws a user-facing message. */
export function parseDetails(raw: { sector?: string; buildingType?: string; sizeSqFt?: string }): ProjectDetails {
  const sector = raw.sector?.trim() || null;
  const buildingType = raw.buildingType?.trim() || null;
  const size = raw.sizeSqFt?.replace(/,/g, "").trim() || null;
  if (sector && !(SECTORS as readonly string[]).includes(sector)) throw new Error(`Unknown sector "${sector}".`);
  if (buildingType && !(BUILDING_TYPES as readonly string[]).includes(buildingType)) throw new Error(`Unknown building type "${buildingType}".`);
  if (size && !/^\d+$/.test(size)) throw new Error(`Size "${raw.sizeSqFt}" isn't a whole number of square feet.`);
  return { sector, buildingType, sizeSqFt: size ? Number(size) : null };
}

/** Fiscal year from the backfill key `backfill:FY<year>:<name>` (plan Phase 3). */
export function fiscalYear(externalProjectKey: string | null): number | null {
  const fy = externalProjectKey?.match(/^backfill:FY(\d{4}):/)?.[1];
  return fy ? Number(fy) : null;
}
