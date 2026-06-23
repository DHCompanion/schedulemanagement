import { describe, it, expect } from "vitest";
import { deriveSectionInfo, isHiddenByCollapse, assignSiblingIndices } from "@/lib/schedule/wbsGrouping";

// Document-order rows (project_summary already excluded by the caller):
//   A (1)            -> top section
//     A.1 (2)         -> sub-section under A
//       A.1.task1 (3)
//       A.1.task2 (3)
//     A.2 (2)         -> sibling sub-section under A
//       A.2.task1 (3)
//   B (1)            -> sibling top section
//     B.task1 (2)
const rows = [
  { id: "A", outlineLevel: 1 },
  { id: "A.1", outlineLevel: 2 },
  { id: "A.1.task1", outlineLevel: 3 },
  { id: "A.1.task2", outlineLevel: 3 },
  { id: "A.2", outlineLevel: 2 },
  { id: "A.2.task1", outlineLevel: 3 },
  { id: "B", outlineLevel: 1 },
  { id: "B.task1", outlineLevel: 2 },
];

describe("deriveSectionInfo", () => {
  const info = deriveSectionInfo(rows);

  it("gives top-level rows an empty ancestor chain", () => {
    expect(info.get("A")?.ancestorIds).toEqual([]);
    expect(info.get("B")?.ancestorIds).toEqual([]);
  });

  it("orders nested ancestor chains root-most first", () => {
    expect(info.get("A.1")?.ancestorIds).toEqual(["A"]);
    expect(info.get("A.1.task1")?.ancestorIds).toEqual(["A", "A.1"]);
    expect(info.get("A.2.task1")?.ancestorIds).toEqual(["A", "A.2"]);
    expect(info.get("B.task1")?.ancestorIds).toEqual(["B"]);
  });

  it("does not leak ancestors across sibling sub-sections", () => {
    expect(info.get("A.2")?.ancestorIds).toEqual(["A"]);
    expect(info.get("A.1.task1")?.ancestorIds).not.toContain("A.2");
  });
});

describe("assignSiblingIndices", () => {
  const info = deriveSectionInfo(rows);
  const indices = assignSiblingIndices(rows, info);

  it("indexes root-level rows by their own sibling order", () => {
    expect(indices.get("A")).toBe(0);
    expect(indices.get("B")).toBe(1);
  });

  it("indexes nested rows by sibling order under their own immediate parent, independent of the parent's index", () => {
    expect(indices.get("A.1")).toBe(0);
    expect(indices.get("A.2")).toBe(1);
    expect(indices.get("B.task1")).toBe(0);
  });

  it("restarts the counter per parent so unrelated groups don't share a sequence", () => {
    expect(indices.get("A.1.task1")).toBe(0);
    expect(indices.get("A.1.task2")).toBe(1);
    expect(indices.get("A.2.task1")).toBe(0);
  });
});

describe("isHiddenByCollapse", () => {
  it("is not hidden when no ancestor is collapsed", () => {
    expect(isHiddenByCollapse(["A", "A.1"], new Set())).toBe(false);
  });

  it("is hidden when the immediate parent is collapsed", () => {
    expect(isHiddenByCollapse(["A", "A.1"], new Set(["A.1"]))).toBe(true);
  });

  it("is hidden when a higher ancestor is collapsed, not just the immediate parent", () => {
    expect(isHiddenByCollapse(["A", "A.1"], new Set(["A"]))).toBe(true);
  });

  it("is not affected by collapsing an unrelated sibling section", () => {
    expect(isHiddenByCollapse(["A", "A.1"], new Set(["A.2"]))).toBe(false);
  });

  it("a top-level row is never hidden by its own collapsed state", () => {
    expect(isHiddenByCollapse([], new Set(["A"]))).toBe(false);
  });
});
