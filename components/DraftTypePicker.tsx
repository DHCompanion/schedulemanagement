"use client";

import { useState } from "react";
import { PROJECT_TYPES, SECTORS, SUBTYPES } from "@/lib/historical";

/** Project type select, plus a subtype select that appears when the chosen type has subtypes. */
export function DraftTypePicker({ type, subType, className }: { type: string; subType: string; className: string }) {
  const [chosen, setChosen] = useState(type);
  const subs = SUBTYPES[chosen];
  return (
    <>
      <select name="type" value={chosen} onChange={(e) => setChosen(e.target.value)} aria-label="Project type" className={className} required>
        <option value="">Project type…</option>
        {SECTORS.map((s) => (
          <optgroup key={s} label={s}>
            {PROJECT_TYPES[s].map((t) => <option key={t}>{t}</option>)}
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
