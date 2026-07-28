// Value-agnostic: the dictionary now holds OS discipline objects, but the
// grouping logic never cared what it was mapping to.
export interface TradeMapResult<T> {
  mapped: { scope: string; discipline: T }[];
  unmappedScopes: string[];
}

export function applyTradeDictionaryWith<T>(scopes: string[], dict: Map<string, T>): TradeMapResult<T> {
  const mapped: { scope: string; discipline: T }[] = [];
  const unmapped = new Set<string>();
  const seen = new Set<string>();
  for (const scope of scopes) {
    if (seen.has(scope)) continue;
    seen.add(scope);
    const discipline = dict.get(scope);
    if (discipline !== undefined) mapped.push({ scope, discipline });
    else unmapped.add(scope);
  }
  return { mapped, unmappedScopes: [...unmapped] };
}
