import { deriveSectionInfo } from "@/lib/schedule/wbsGrouping";

export interface PhaseInput {
  id: string;
  outlineLevel: number;
  outlineNumber: string | null;
  name: string;
}

// A WBS band that separates the work into phases (or "areas" — same idea, some
// schedulers label them that way). Matched by name because the band can sit at
// any WBS depth: on this project it's L3 ("Phase 1 - Patient Waiting"), not the
// top-level group (which is just the project).
const PHASE_LABEL = /^\s*(?:phase|area)\b/i;

// Reduce a band name to the token that identifies the phase/area, so it joins to
// procurement's `phase` field: "Phase 1 - Patient Waiting" -> "1",
// "Phase 2B - New Entrance" -> "2B", "Area A - North" -> "A". Falls back to the
// trimmed name if there's no token after the label.
export function normalizePhase(name: string): string {
  const m = name.match(/^\s*(?:phase|area)\s+([0-9]+[a-z]?|\S+)/i);
  return m ? m[1].replace(/[^0-9a-z]+$/i, "") : name.trim();
}

// Each activity's phase = the OUTERMOST ancestor whose name reads as a phase/area
// band, normalized. A project with no such band (unphased) yields null for every
// activity, which downstream treats as "no phase" — matching falls back to
// scope-only rather than breaking. deriveSectionInfo needs rows in document
// (outlineNumber) order.
export function phaseByActivityId(activities: PhaseInput[]): Map<string, string | null> {
  const ordered = [...activities].sort((a, b) =>
    (a.outlineNumber ?? "").localeCompare(b.outlineNumber ?? "", undefined, { numeric: true }),
  );
  const byId = new Map(ordered.map((a) => [a.id, a]));
  const info = deriveSectionInfo(ordered);
  const result = new Map<string, string | null>();
  for (const a of ordered) {
    const ancestorIds = info.get(a.id)?.ancestorIds ?? []; // outermost -> innermost
    let phase: string | null = null;
    for (const id of ancestorIds) {
      const anc = byId.get(id);
      if (anc && PHASE_LABEL.test(anc.name)) {
        phase = normalizePhase(anc.name);
        break;
      }
    }
    result.set(a.id, phase);
  }
  return result;
}
