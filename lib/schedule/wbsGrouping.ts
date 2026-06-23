export interface OutlineRow {
  id: string;
  outlineLevel: number;
}

export interface SectionInfo {
  ancestorIds: string[];
}

/**
 * Derive each row's ancestor chain from document order, using the same
 * "nearest preceding row with a strictly smaller outlineLevel" rule as
 * lib/msp/hierarchy.ts's deriveParents, generalized to track the whole
 * ancestor stack rather than just the immediate parent.
 */
export function deriveSectionInfo<T extends OutlineRow>(rows: T[]): Map<string, SectionInfo> {
  const result = new Map<string, SectionInfo>();
  const stack: T[] = [];
  for (const row of rows) {
    while (stack.length && stack[stack.length - 1].outlineLevel >= row.outlineLevel) stack.pop();
    const ancestorIds = stack.map((r) => r.id);
    result.set(row.id, { ancestorIds });
    stack.push(row);
  }
  return result;
}

export function isHiddenByCollapse(ancestorIds: string[], collapsed: Set<string>): boolean {
  return ancestorIds.some((id) => collapsed.has(id));
}

const ROOT_GROUP = "__root__";

/**
 * Index each row by its position among siblings sharing the same immediate
 * parent (root rows all share one implicit group), counted independently
 * per parent so a color/position cycle keyed on this never repeats across
 * adjacent siblings regardless of how deep — or how shallow — the WBS tree is.
 */
export function assignSiblingIndices<T extends OutlineRow>(rows: T[], info: Map<string, SectionInfo>): Map<string, number> {
  const counters = new Map<string, number>();
  const result = new Map<string, number>();
  for (const row of rows) {
    const ancestorIds = info.get(row.id)?.ancestorIds ?? [];
    const parentKey = ancestorIds.length ? ancestorIds[ancestorIds.length - 1] : ROOT_GROUP;
    const idx = counters.get(parentKey) ?? 0;
    result.set(row.id, idx);
    counters.set(parentKey, idx + 1);
  }
  return result;
}
