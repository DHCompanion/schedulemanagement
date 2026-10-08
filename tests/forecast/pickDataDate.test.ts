import { describe, it, expect } from "vitest";
import { pickDataDate } from "@/lib/forecast/resolveStatusDate";

const d = (s: string) => new Date(s);

describe("pickDataDate", () => {
  const julyUpdate = { date: d("2026-07-29"), setAt: d("2026-07-29T18:00:00Z") };
  const octImport = { date: d("2026-10-08T17:00:00Z"), setAt: d("2026-10-08T20:00:00Z") };

  it("lets a newer import's status date beat an older finalized update", () => {
    expect(pickDataDate([julyUpdate, octImport])).toEqual(octImport.date);
  });
  it("lets a date set by hand afterwards beat both, even when it is earlier", () => {
    const manual = { date: d("2026-09-01T17:00:00Z"), setAt: d("2026-10-08T21:00:00Z") };
    expect(pickDataDate([manual, julyUpdate, octImport])).toEqual(manual.date);
  });
  it("lets a later progress update replace a date set by hand", () => {
    const manual = { date: d("2026-09-01T17:00:00Z"), setAt: d("2026-10-08T21:00:00Z") };
    const novUpdate = { date: d("2026-11-02"), setAt: d("2026-11-02T15:00:00Z") };
    expect(pickDataDate([manual, novUpdate, octImport])).toEqual(novUpdate.date);
  });
  it("ignores a source with no date, and returns null when nothing is stated", () => {
    expect(pickDataDate([{ date: null, setAt: d("2026-12-01") }, julyUpdate])).toEqual(julyUpdate.date);
    expect(pickDataDate([{ date: null, setAt: null }])).toBeNull();
  });
});
