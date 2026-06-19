/** Exact-match key for the scope dictionary: lowercase, trim, collapse whitespace. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
