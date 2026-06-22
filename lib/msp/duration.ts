/** Parse an ISO-8601 duration like "PT8H0M0S" to minutes. */
export function parseIsoDurationToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value.trim());
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  const hours = Number(m[1] ?? 0);
  const minutes = Number(m[2] ?? 0);
  const seconds = Number(m[3] ?? 0);
  return hours * 60 + minutes + seconds / 60;
}

/** MSPDI slack/lag numeric duration fields are integer tenths of a minute. */
export function tenthsOfMinuteToMinutes(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return n / 10;
}

/** Convert working minutes to working days using the project's MinutesPerDay. */
export function minutesToDays(minutes: number | null, minutesPerDay: number): number | null {
  if (minutes === null || !minutesPerDay) return null;
  return minutes / minutesPerDay;
}

/** Inverse of parseIsoDurationToMinutes: format minutes back to an ISO-8601 duration like "PT8H0M0S". */
export function minutesToIsoDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  const totalSeconds = Math.round(minutes * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `PT${hours}H${mins}M${secs}S`;
}
