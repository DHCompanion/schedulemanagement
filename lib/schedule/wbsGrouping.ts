export interface OutlineRow {
  id: string;
  outlineLevel: number;
}

export interface SectionInfo {
  ancestorIds: string[];
  topSectionId: string | null;
}

/**
 * Derive each row's ancestor chain and top-level (outlineLevel === 1) section
 * from document order, using the same "nearest preceding row with a
 * strictly smaller outlineLevel" rule as lib/msp/hierarchy.ts's
 * deriveParents, generalized to track the whole ancestor stack rather than
 * just the immediate parent.
 */
export function deriveSectionInfo<T extends OutlineRow>(rows: T[]): Map<string, SectionInfo> {
  const result = new Map<string, SectionInfo>();
  const stack: T[] = [];
  for (const row of rows) {
    while (stack.length && stack[stack.length - 1].outlineLevel >= row.outlineLevel) stack.pop();
    const ancestorIds = stack.map((r) => r.id);
    const topSectionId = row.outlineLevel === 1 ? row.id : (stack.find((r) => r.outlineLevel === 1)?.id ?? null);
    result.set(row.id, { ancestorIds, topSectionId });
    stack.push(row);
  }
  return result;
}

export function isHiddenByCollapse(ancestorIds: string[], collapsed: Set<string>): boolean {
  return ancestorIds.some((id) => collapsed.has(id));
}
