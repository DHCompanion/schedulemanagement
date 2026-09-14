// Push-link helpers: which activity's slip pushed which, surfaced on the Gantt.
// The forecast layer already computes `pushedByUid` per activity (the predecessor
// whose slip moved it); these turn that into a per-driver count and the geometry
// for an on-demand connector.

/** How many activities each driver uid pushes (only activities with a driver count). */
export function countPushesByDriver(
  entries: { externalUid: number; pushedByUid: number | null }[],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const e of entries) {
    if (e.pushedByUid === null) continue;
    counts.set(e.pushedByUid, (counts.get(e.pushedByUid) ?? 0) + 1);
  }
  return counts;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * SVG path for a connector from a driver point to the pushed point. A cubic
 * bezier with horizontal control handles reads as a smooth "flows into" link
 * rather than a hard diagonal; the handle length scales with the horizontal gap
 * (min 24px) so short and long links both curve sensibly.
 */
export function connectorPath(from: Point, to: Point): string {
  const dx = Math.max(24, Math.abs(to.x - from.x) * 0.4);
  return `M${from.x},${from.y} C${from.x + dx},${from.y} ${to.x - dx},${to.y} ${to.x},${to.y}`;
}
