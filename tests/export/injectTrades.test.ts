import { describe, it, expect } from "vitest";
import { injectTrades } from "@/lib/export/injectTrades";

function docWith(existing?: Record<string, unknown>) {
  return {
    Project: {
      ...(existing ? { ExtendedAttributes: { ExtendedAttribute: existing } } : {}),
      Tasks: { Task: [{ UID: "1", Name: "Hang Drywall" }, { UID: "2", Name: "Pull Wire" }] },
    },
  } as Record<string, unknown>;
}

const trades = new Map([
  [1, { disciplineName: "09A: DRYWALL", partnerName: "Carrco" }],
  [2, { disciplineName: "26A: ELECTRICAL", partnerName: null }],
]);

function defs(doc: Record<string, unknown>) {
  const p = doc.Project as Record<string, unknown>;
  const ea = (p.ExtendedAttributes as Record<string, unknown>)?.ExtendedAttribute;
  return (Array.isArray(ea) ? ea : [ea]) as Record<string, unknown>[];
}
function taskAttrs(doc: Record<string, unknown>, i: number) {
  const project = doc.Project as Record<string, unknown>;
  const tasks = (project.Tasks as Record<string, unknown>).Task as Record<string, unknown>[];
  const ea = tasks[i].ExtendedAttribute;
  return (Array.isArray(ea) ? ea : ea ? [ea] : []) as Record<string, unknown>[];
}

describe("injectTrades", () => {
  it("declares both aliases and writes values onto matching tasks", () => {
    const doc = injectTrades(docWith(), trades);
    const aliases = defs(doc).map((d) => d.Alias);
    expect(aliases).toEqual(expect.arrayContaining(["Discipline", "Trade Partner"]));

    const first = taskAttrs(doc, 0);
    expect(first).toHaveLength(2);
    expect(first.map((a) => a.Value)).toEqual(expect.arrayContaining(["09A: DRYWALL", "Carrco"]));
  });

  it("writes the discipline alone when no partner is assigned", () => {
    const doc = injectTrades(docWith(), trades);
    const second = taskAttrs(doc, 1);
    expect(second.map((a) => a.Value)).toEqual(["26A: ELECTRICAL"]);
  });

  it("skips text slots the file already uses", () => {
    const doc = injectTrades(
      docWith({ FieldID: "188743731", FieldName: "Text1", Alias: "Phoenix ID" }),
      trades,
    );
    // Phoenix ID survives untouched, and ours land in the next free slots.
    const phoenix = defs(doc).find((d) => d.Alias === "Phoenix ID");
    expect(phoenix?.FieldID).toBe("188743731");
    expect(defs(doc).find((d) => d.Alias === "Discipline")?.FieldID).toBe("188743734");
    expect(defs(doc).find((d) => d.Alias === "Trade Partner")?.FieldID).toBe("188743737");
    expect(defs(doc)).toHaveLength(3);
  });

  it("writes nothing when no activity resolves to a trade", () => {
    const doc = injectTrades(docWith(), new Map());
    expect(doc.Project).not.toHaveProperty("ExtendedAttributes");
    expect(taskAttrs(doc, 0)).toHaveLength(0);
  });
});
