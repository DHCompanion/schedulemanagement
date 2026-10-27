"use client";

import { useState } from "react";
/** Project type select, plus a subtype select that appears when the chosen type has subtypes. Lists come from the page: lib/historical loads Prisma. */
export function DraftTypePicker({ types, subTypes, type, subType, className }: {
  types: { sector: string; types: readonly string[] }[];
  subTypes: Record<string, readonly string[]>;
  type: string;
  subType: string;
  className: string;
}) {
  const [chosen, setChosen] = useState(type);
  const subs = subTypes[chosen];
  return (
    <>
      <select name="type" value={chosen} onChange={(e) => setChosen(e.target.value)} aria-label="Project type" className={className} required>
        <option value="">Project type…</option>
        {types.map(({ sector, types }) => (
          <optgroup key={sector} label={sector}>
            {types.map((t) => <option key={t}>{t}</option>)}
          </optgroup>
        ))}
      </select>
      {subs && (
        // Keyed by type so a new type starts at "Any subtype".
        <select key={chosen} name="sub" defaultValue={chosen === type ? subType : ""} aria-label="Subtype" className={className}>
          <option value="">Any subtype</option>
          {subs.map((t) => <option key={t}>{t}</option>)}
        </select>
      )}
    </>
  );
}
