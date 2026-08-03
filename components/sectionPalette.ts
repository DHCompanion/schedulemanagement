// The six-color WBS section identity system carried over from the old body —
// the owner was explicit that section colors stay. Bars keep semantic colors;
// this palette only ever touches section headers, row rails, and card edges.
export interface SectionPaletteEntry {
  bg: string;
  nestedBg: string;
  text: string;
  rail: string;
}

export const SECTION_PALETTE: SectionPaletteEntry[] = [
  { bg: "bg-indigo-100", nestedBg: "bg-indigo-50", text: "text-indigo-900", rail: "border-indigo-400" },
  { bg: "bg-amber-100", nestedBg: "bg-amber-50", text: "text-amber-900", rail: "border-amber-400" },
  { bg: "bg-emerald-100", nestedBg: "bg-emerald-50", text: "text-emerald-900", rail: "border-emerald-400" },
  { bg: "bg-rose-100", nestedBg: "bg-rose-50", text: "text-rose-900", rail: "border-rose-400" },
  { bg: "bg-sky-100", nestedBg: "bg-sky-50", text: "text-sky-900", rail: "border-sky-400" },
  { bg: "bg-violet-100", nestedBg: "bg-violet-50", text: "text-violet-900", rail: "border-violet-400" },
];

export function paletteEntry(index: number): SectionPaletteEntry {
  return SECTION_PALETTE[index % SECTION_PALETTE.length];
}
