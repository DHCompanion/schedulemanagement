/** Stable key for threading the same activity across import versions. */
export function canonicalActivityKey(wbsCode: string | null, name: string): string {
  const wbs = (wbsCode ?? "").trim();
  const normName = name.trim().toLowerCase().replace(/\s+/g, " ");
  return `${wbs}|${normName}`;
}

/** Key of the i-th finer activity a split mints from a coarse one. */
export function finerActivityKey(coarseWbsCode: string | null, scope: string, i: number): string {
  return canonicalActivityKey(coarseWbsCode ? `${coarseWbsCode}.${i + 1}` : null, scope);
}
