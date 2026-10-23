import type { ImportTier } from "@/lib/health/importTier";

const TIERS: Record<ImportTier, { label: string; className: string }> = {
  as_built: { label: "As-built", className: "bg-green-100 text-green-700" },
  baseline: { label: "Baseline", className: "bg-blue-100 text-blue-700" },
  rough: { label: "Rough", className: "bg-amber-100 text-amber-700" },
  junk: { label: "Too small", className: "bg-slate-100 text-slate-600" },
};

export function TierBadge({ tier }: { tier: ImportTier }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${TIERS[tier].className}`}>{TIERS[tier].label}</span>;
}
