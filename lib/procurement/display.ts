/** Per-partner procurement tallies, as cached from the OS context packet. */
export type ActivityProcurement = {
  itemCount: number;
  behindCount: number;
  submittalLateCount: number;
  projectedLateCount: number;
  releasedAtRiskCount: number;
  missingDatesCount: number;
};

/**
 * Turns a partner's tallies into the lines shown under an activity. Counts are
 * plain tallies — no singular/plural inflection, which would be more code than
 * the clarity it buys.
 *
 * Every figure here is project-wide for the partner, not scoped to the activity
 * being read. The caller's label ("This trade's procurement:") carries that.
 */
export function describeProcurement(
  p: ActivityProcurement,
): { headline: string; details: string[] } {
  const headline =
    p.behindCount > 0
      ? `${p.behindCount} of ${p.itemCount} items behind`
      : `${p.itemCount} items, none behind`;

  const details: string[] = [];

  const lateness: string[] = [];
  if (p.submittalLateCount > 0) lateness.push(`${p.submittalLateCount} submittal late`);
  if (p.projectedLateCount > 0) lateness.push(`${p.projectedLateCount} projected late`);
  if (lateness.length > 0) details.push(lateness.join(", "));

  if (p.releasedAtRiskCount > 0) details.push(`${p.releasedAtRiskCount} released at risk`);
  // Not "behind", but not fine either: procurement cannot assess these at all.
  if (p.missingDatesCount > 0) details.push(`${p.missingDatesCount} with no required-on-site date`);

  return { headline, details };
}
