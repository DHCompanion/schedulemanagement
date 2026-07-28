import { prisma } from "@/lib/db";

// Disciplines are not invented here. Skiles Connect attaches them to the trade
// partners it puts on a project, and the launch handoff caches that roster
// (OsTradePartner). A project with no roster has no disciplines — there is no
// local fallback vocabulary any more.
export type OsDiscipline = { id: number; name: string; division: string };
export type OsPartner = { osPartnerId: number; name: string };

type CachedDiscipline = { id?: unknown; name?: unknown; division?: unknown };

function readDisciplines(value: unknown): OsDiscipline[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => entry as CachedDiscipline)
    .filter((entry) => typeof entry.id === "number" && typeof entry.name === "string")
    .map((entry) => ({
      id: entry.id as number,
      name: entry.name as string,
      division: typeof entry.division === "string" ? entry.division : "",
    }));
}

/** Every discipline Connect associates with this project's partners, deduped. */
export async function getProjectDisciplines(projectId: string): Promise<OsDiscipline[]> {
  const partners = await prisma.osTradePartner.findMany({
    where: { projectId, doNotUse: false },
    select: { disciplines: true },
  });

  const byId = new Map<number, OsDiscipline>();
  for (const partner of partners) {
    for (const discipline of readDisciplines(partner.disciplines)) {
      if (!byId.has(discipline.id)) byId.set(discipline.id, discipline);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Partners Connect says can do this discipline on this project. */
export async function getPartnersForDiscipline(projectId: string, osDisciplineId: number): Promise<OsPartner[]> {
  const partners = await prisma.osTradePartner.findMany({
    where: { projectId, doNotUse: false },
    select: { osPartnerId: true, name: true, disciplines: true },
    orderBy: { name: "asc" },
  });

  return partners
    .filter((partner) => readDisciplines(partner.disciplines).some((d) => d.id === osDisciplineId))
    .map((partner) => ({ osPartnerId: partner.osPartnerId, name: partner.name }));
}

export async function getTradeDictionary(): Promise<Map<string, OsDiscipline>> {
  const rows = await prisma.tradeDictionaryEntry.findMany();
  return new Map(
    rows.map((row) => [row.canonicalScope, { id: row.osDisciplineId, name: row.disciplineName, division: "" }])
  );
}

export async function confirmDiscipline(
  canonicalScope: string,
  osDisciplineId: number,
  disciplineName: string,
  personId?: number | null,
): Promise<void> {
  const scope = canonicalScope.trim();
  const name = disciplineName.trim();
  if (!scope || !name || !Number.isInteger(osDisciplineId)) return;
  await prisma.tradeDictionaryEntry.upsert({
    where: { canonicalScope: scope },
    create: { canonicalScope: scope, osDisciplineId, disciplineName: name, personId: personId ?? null },
    update: { osDisciplineId, disciplineName: name, timesConfirmed: { increment: 1 }, personId: personId ?? null },
  });
}

export async function assignTradePartner(
  projectId: string,
  osDisciplineId: number,
  osPartnerId: number,
  personId?: number | null,
): Promise<void> {
  if (!Number.isInteger(osDisciplineId) || !Number.isInteger(osPartnerId)) return;

  // Only a partner Connect actually placed on this project may be assigned —
  // the id arrives from the client and is not trusted on its own.
  const partner = await prisma.osTradePartner.findUnique({
    where: { projectId_osPartnerId: { projectId, osPartnerId } },
    select: { name: true, doNotUse: true },
  });
  if (!partner || partner.doNotUse) return;

  await prisma.projectTradeAssignment.upsert({
    where: { projectId_osDisciplineId: { projectId, osDisciplineId } },
    create: { projectId, osDisciplineId, osPartnerId, partnerName: partner.name, personId: personId ?? null },
    update: { osPartnerId, partnerName: partner.name, personId: personId ?? null },
  });
}

export type ProjectAssignment = { osPartnerId: number; name: string; onRoster: boolean };

/** Assignments by discipline id. The live roster name wins over the snapshot. */
export async function getProjectAssignments(projectId: string): Promise<Map<number, ProjectAssignment>> {
  const [assignments, roster] = await Promise.all([
    prisma.projectTradeAssignment.findMany({ where: { projectId } }),
    prisma.osTradePartner.findMany({ where: { projectId }, select: { osPartnerId: true, name: true } }),
  ]);
  const current = new Map(roster.map((partner) => [partner.osPartnerId, partner.name]));

  return new Map(
    assignments.map((assignment) => [
      assignment.osDisciplineId,
      {
        osPartnerId: assignment.osPartnerId,
        name: current.get(assignment.osPartnerId) ?? assignment.partnerName,
        onRoster: current.has(assignment.osPartnerId),
      },
    ])
  );
}

export async function dismissScope(
  projectId: string,
  canonicalScope: string,
  dismissedBy?: string,
  personId?: number | null,
): Promise<void> {
  await prisma.tradeScopeDismissal.upsert({
    where: { projectId_canonicalScope: { projectId, canonicalScope } },
    create: { projectId, canonicalScope, dismissedBy, personId: personId ?? null },
    update: {},
  });
}

export async function restoreScope(projectId: string, canonicalScope: string): Promise<void> {
  await prisma.tradeScopeDismissal.deleteMany({ where: { projectId, canonicalScope } });
}

export async function getDismissedScopes(projectId: string): Promise<string[]> {
  const rows = await prisma.tradeScopeDismissal.findMany({ where: { projectId }, select: { canonicalScope: true } });
  return rows.map((row) => row.canonicalScope);
}
