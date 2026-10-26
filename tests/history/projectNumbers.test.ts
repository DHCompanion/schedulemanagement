import { describe, it, expect } from "vitest";
import { planProjectNumbers } from "@/lib/historical";

describe("planProjectNumbers", () => {
  const projects = [
    { id: "a", name: "BSW Plano Healing Garden", fy: 2024, projectNumber: null },
    { id: "b", name: "Basepoint Arlington", fy: 2021, projectNumber: null },
    { id: "c", name: "Basepoint Arlington", fy: 2022, projectNumber: "26006" },
    { id: "d", name: "Untouched", fy: 2023, projectNumber: "2023001" },
  ];
  const row = (Project: string, FY: string, n: string) => ({ Project, FY, "Project number": n });

  it("matches on name and fiscal year, skipping blanks and numbers already set", () => {
    const plan = planProjectNumbers(
      [row("BSW Plano Healing Garden", "2024", " 2024020 "), row("Basepoint Arlington", "2021", "2022010"), row("Basepoint Arlington", "2022", "26006"), row("Untouched", "2023", "")],
      projects,
    );
    expect(plan.updates).toEqual([{ id: "a", projectNumber: "2024020" }, { id: "b", projectNumber: "2022010" }]);
    expect(plan.deletes).toEqual([]);
    expect(plan.problems).toEqual([]);
  });

  it("marks rows saying delete for deletion, in any case; one already gone is skipped", () => {
    const plan = planProjectNumbers([row("Untouched", "2023", " Delete "), row("Nowhere", "2024", "delete")], projects);
    expect(plan.deletes).toEqual([{ id: "d", label: "Untouched (FY2023)" }]);
    expect(plan.updates).toEqual([]);
    expect(plan.problems).toEqual([]);
  });

  it("reports rows it can't place or numbers that don't parse", () => {
    const plan = planProjectNumbers([row("Nowhere", "2024", "1"), row("BSW Plano Healing Garden", "2024", "20 24")], projects);
    expect(plan.updates).toEqual([]);
    expect(plan.problems).toHaveLength(2);
  });
});
