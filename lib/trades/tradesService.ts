import { prisma } from "@/lib/db";

export async function getTradeDictionary(): Promise<Map<string, string>> {
  const rows = await prisma.tradeDictionaryEntry.findMany();
  return new Map(rows.map((r) => [r.canonicalScope, r.tradeDiscipline]));
}

export async function getKnownDisciplines(): Promise<string[]> {
  const rows = await prisma.tradeDictionaryEntry.findMany({
    distinct: ["tradeDiscipline"],
    select: { tradeDiscipline: true },
    orderBy: { tradeDiscipline: "asc" },
  });
  return rows.map((r) => r.tradeDiscipline);
}

export async function confirmDiscipline(canonicalScope: string, discipline: string): Promise<void> {
  const scope = canonicalScope.trim();
  const disc = discipline.trim();
  if (!scope || !disc) return;
  await prisma.tradeDictionaryEntry.upsert({
    where: { canonicalScope: scope },
    create: { canonicalScope: scope, tradeDiscipline: disc },
    update: { tradeDiscipline: disc, timesConfirmed: { increment: 1 } },
  });
}

export async function getTradePartners(): Promise<string[]> {
  const rows = await prisma.tradePartner.findMany({ select: { name: true }, orderBy: { name: "asc" } });
  return rows.map((r) => r.name);
}

export async function getProjectAssignments(projectId: string): Promise<Map<string, string>> {
  const rows = await prisma.projectTradeAssignment.findMany({ where: { projectId }, include: { tradePartner: true } });
  return new Map(rows.map((r) => [r.tradeDiscipline, r.tradePartner.name]));
}

export async function assignTradePartner(projectId: string, discipline: string, companyName: string): Promise<void> {
  const disc = discipline.trim();
  const name = companyName.trim();
  if (!disc || !name) return;
  const partner = await prisma.tradePartner.upsert({ where: { name }, create: { name }, update: {} });
  await prisma.projectTradeAssignment.upsert({
    where: { projectId_tradeDiscipline: { projectId, tradeDiscipline: disc } },
    create: { projectId, tradeDiscipline: disc, tradePartnerId: partner.id },
    update: { tradePartnerId: partner.id },
  });
}
