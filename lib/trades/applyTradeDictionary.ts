export interface TradeMapResult {
  mapped: { scope: string; discipline: string }[];
  unmappedScopes: string[];
}

export function applyTradeDictionaryWith(scopes: string[], dict: Map<string, string>): TradeMapResult {
  const mapped: { scope: string; discipline: string }[] = [];
  const unmapped = new Set<string>();
  const seen = new Set<string>();
  for (const scope of scopes) {
    if (seen.has(scope)) continue;
    seen.add(scope);
    const discipline = dict.get(scope);
    if (discipline) mapped.push({ scope, discipline });
    else unmapped.add(scope);
  }
  return { mapped, unmappedScopes: [...unmapped] };
}
