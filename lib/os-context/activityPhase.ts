import { deriveSectionInfo } from "@/lib/schedule/wbsGrouping";

export interface PhaseInput {
  id: string;
  outlineLevel: number;
  outlineNumber: string | null;
  name: string;
}

// The phase is the outermost WBS ancestor (top-level group). deriveSectionInfo
// needs rows in document order, which is outlineNumber order (natural WBS order).
export function phaseByActivityId(activities: PhaseInput[]): Map<string, string | null> {
  const ordered = [...activities].sort((a, b) =>
    (a.outlineNumber ?? "").localeCompare(b.outlineNumber ?? "", undefined, { numeric: true }),
  );
  const nameById = new Map(ordered.map((a) => [a.id, a.name]));
  const info = deriveSectionInfo(ordered);
  const result = new Map<string, string | null>();
  for (const a of ordered) {
    const ancestorIds = info.get(a.id)?.ancestorIds ?? [];
    const topId = ancestorIds[0]; // outermost = phase
    result.set(a.id, topId ? nameById.get(topId) ?? null : null);
  }
  return result;
}
