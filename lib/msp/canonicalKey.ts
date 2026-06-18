/** Stable key for threading the same activity across import versions. */
export function canonicalActivityKey(wbsCode: string | null, name: string): string {
  const wbs = (wbsCode ?? "").trim();
  const normName = name.trim().toLowerCase().replace(/\s+/g, " ");
  return `${wbs}|${normName}`;
}
