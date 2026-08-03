const DAY_MS = 24 * 60 * 60 * 1000;

export function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function rollForwardToWeekday(t: number): number {
  while (isWeekend(new Date(t))) t += DAY_MS;
  return t;
}

/**
 * Advance `days` working days (fractional allowed, must be >= 0) skipping
 * Sat/Sun in UTC. A start on a weekend rolls forward to Monday first, keeping
 * its time of day. Fractional remainders advance clock time and roll off any
 * weekend they land on.
 */
export function addWorkingDays(start: Date, days: number): Date {
  let t = rollForwardToWeekday(start.getTime());
  let whole = Math.floor(days);
  const frac = days - whole;
  while (whole > 0) {
    t = rollForwardToWeekday(t + DAY_MS);
    whole--;
  }
  if (frac > 0) t = rollForwardToWeekday(t + frac * DAY_MS);
  return new Date(t);
}

/**
 * Whole working days from a's UTC date to b's UTC date, ignoring time of day.
 * 0 for the same date; negative when b is earlier. Each forward day-step that
 * lands on a weekday counts, so Fri -> next Mon is 1.
 */
export function workingDaysBetween(a: Date, b: Date): number {
  const dayA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const dayB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  const sign = dayB >= dayA ? 1 : -1;
  const [from, to] = sign === 1 ? [dayA, dayB] : [dayB, dayA];
  let count = 0;
  // ponytail: O(span) day loop — swap for arithmetic if profiling ever cares.
  for (let t = from; t < to; t += DAY_MS) {
    if (!isWeekend(new Date(t + DAY_MS))) count++;
  }
  return sign * count;
}
