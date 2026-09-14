/**
 * A linked procurement item's material is meant to be on site BEFORE its
 * activity starts. When the cached required-on-site date lands on or after the
 * activity's start, the material would arrive too late to be usable — almost
 * always the sign of a stale procurement link (or a wrong date) rather than a
 * real plan. The schedule flags such a row so the mismatch is visible without
 * opening the item.
 *
 * Both arguments are ISO date strings (date-only or full datetime); comparison
 * is by calendar date, so a time-of-day component never changes the verdict.
 */
export function isRequiredOnSiteOutOfSync(requiredOnSite: string | null, start: string | null): boolean {
  if (!requiredOnSite || !start) return false;
  return requiredOnSite.slice(0, 10) >= start.slice(0, 10);
}
