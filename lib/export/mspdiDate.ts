function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** MSPDI datetimes are naive-local; stored dates are UTC wall-clock, so emit UTC components with no zone. */
export function toMspdiDate(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}
