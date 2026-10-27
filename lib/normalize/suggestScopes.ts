import { normalizeName } from "@/lib/normalize/normalizeName";

// Schedule shorthand, so "Layout OH Elec" meets "Layout Overhead Electrical".
const SYNONYMS: Record<string, string> = {
  oh: "overhead", demo: "demolish", demolition: "demolish", elec: "electrical", mech: "mechanical",
  plumb: "plumbing", installation: "install", trimout: "trim", inst: "install", ceil: "ceiling", rm: "room",
};

// The name list is finite (tens of thousands), so cache each name's words.
const cache = new Map<string, Set<string>>();
function tokens(s: string): Set<string> {
  let t = cache.get(s);
  if (!t) cache.set(s, (t = wordsOf(s)));
  return t;
}

function wordsOf(s: string): Set<string> {
  const words = normalizeName(s).split(/[^a-z0-9]+/).filter(Boolean).map((w) => SYNONYMS[w] ?? w);
  // ponytail: plural "s" only; a real stemmer if suggestions miss on "-ing"/"-ed".
  return new Set(words.map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)).filter((w) => w !== "out"));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Score each known scope by its own words and by the names already mapped to
 * it (mapped: normalized name → scope), so past approvals teach the matcher.
 */
function scored(rawName: string, knownScopes: string[], mapped?: Map<string, string>) {
  const rt = tokens(rawName);
  const best = new Map(knownScopes.map((s) => [s, jaccard(rt, tokens(s))]));
  for (const [name, scope] of mapped ?? []) {
    if (best.has(scope)) best.set(scope, Math.max(best.get(scope)!, jaccard(rt, tokens(name))));
  }
  return [...best].filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
}

/** Rank known scopes by word overlap with the raw name; suggestions only (no auto-apply). */
export function suggestScopes(rawName: string, knownScopes: string[], limit = 5, mapped?: Map<string, string>): string[] {
  return scored(rawName, knownScopes, mapped).slice(0, limit).map(([s]) => s);
}

/** The top suggestion and its overlap (0–1), or null when nothing overlaps. */
export function bestMatch(rawName: string, knownScopes: string[], mapped?: Map<string, string>): { scope: string; score: number } | null {
  const [top] = scored(rawName, knownScopes, mapped);
  return top ? { scope: top[0], score: top[1] } : null;
}
