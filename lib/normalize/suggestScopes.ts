import { normalizeName } from "@/lib/normalize/normalizeName";

function tokens(s: string): Set<string> {
  return new Set(normalizeName(s).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Rank known scopes by token overlap with the raw name; suggestions only (no auto-apply). */
export function suggestScopes(rawName: string, knownScopes: string[], limit = 5): string[] {
  const rt = tokens(rawName);
  return knownScopes
    .map((s) => ({ s, score: jaccard(rt, tokens(s)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.length - b.s.length)
    .slice(0, limit)
    .map((x) => x.s);
}
