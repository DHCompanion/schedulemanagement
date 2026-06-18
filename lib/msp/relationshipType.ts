export type RelationshipType = "FS" | "SS" | "FF" | "SF";

const MAP: Record<string, RelationshipType> = {
  "0": "FF",
  "1": "FS",
  "2": "SF",
  "3": "SS",
};

/** Map an MSPDI PredecessorLink Type code to a canonical relationship type. */
export function mapRelationshipType(rawType: string | number | null | undefined): RelationshipType {
  const key = String(rawType ?? "1");
  return MAP[key] ?? "FS";
}
