/** The activities an agent saved into a draft, from its AgentWrite rows (refused writes changed nothing). */
export function agentSummary(rows: { result: unknown }[]): string[] {
  const keys = new Set<string>();
  for (const { result: r } of rows)
    if (r && typeof r === "object" && (r as { saved?: unknown }).saved === true && Array.isArray((r as { activities?: unknown }).activities))
      for (const k of (r as { activities: unknown[] }).activities) if (typeof k === "string") keys.add(k);
  return [...keys];
}
