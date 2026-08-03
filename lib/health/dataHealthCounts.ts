import { prisma } from "@/lib/db";
import { applyDictionary, getDictionary } from "@/lib/normalize/normalizationService";
import { normalizeName } from "@/lib/normalize/normalizeName";
import { getCompleteness } from "@/lib/completeness/completenessService";
import { getTradeDictionary, getDismissedScopes } from "@/lib/trades/tradesService";
import { applyTradeDictionaryWith } from "@/lib/trades/applyTradeDictionary";

export interface DataHealthCounts {
  naming: number;
  granularity: number;
  trades: number;
  total: number;
}

/**
 * Open-item counts for the Data Health tab badge — the same three queues the
 * tab's sections show: unmapped activity names, coarse-activity flags, and
 * unassigned (undismissed) scopes. Loud after an import, zero when clean.
 */
export async function getDataHealthCounts(projectId: string): Promise<DataHealthCounts> {
  const latest = await prisma.scheduleImport.findFirst({
    where: { projectId },
    orderBy: { importedAt: "desc" },
    include: { activities: true },
  });
  const leaves = (latest?.activities ?? []).filter(
    (a) => a.type !== "summary" && a.type !== "project_summary",
  );

  const { unmappedNames } = await applyDictionary(leaves);

  const completeness = await getCompleteness(projectId);
  const granularity = completeness.hasImport ? completeness.issues.length : 0;

  const scopeDict = await getDictionary();
  const scopesPresent = new Set<string>();
  for (const a of leaves) {
    const scope = scopeDict.get(normalizeName(a.name));
    if (scope) scopesPresent.add(scope);
  }
  const { unmappedScopes } = applyTradeDictionaryWith([...scopesPresent], await getTradeDictionary());
  const dismissed = new Set(await getDismissedScopes(projectId));
  const trades = unmappedScopes.filter((s) => !dismissed.has(s)).length;

  const naming = unmappedNames.length;
  return { naming, granularity, trades, total: naming + granularity + trades };
}
