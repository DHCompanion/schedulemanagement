import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseForExport, buildMspdi } from "@/lib/export/serializeMspdi";
import { injectActuals } from "@/lib/export/injectActuals";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");

function findTask(doc: Record<string, unknown>, uid: string) {
  const list = ((doc.Project as any).Tasks.Task) as any[];
  return list.find((t) => String(t.UID) === uid);
}

describe("serializeMspdi round-trip", () => {
  it("preserves the declaration, namespace, and task count through parse -> build -> parse", () => {
    const out = buildMspdi(parseForExport(xml));
    expect(out.startsWith("<?xml")).toBe(true);
    const reparsed = parseForExport(out);
    expect((reparsed.Project as any)["@_xmlns"]).toBe("http://schemas.microsoft.com/project");
    expect(((reparsed.Project as any).Tasks.Task as any[]).length).toBe(5);
  });

  it("carries injected actuals through serialization", () => {
    const doc = parseForExport(xml);
    injectActuals(doc, new Map([[2, { status: "in_progress", actualStart: new Date("2026-06-16T00:00:00Z"), actualFinish: null, percentComplete: 50 }]]));
    const reparsed = parseForExport(buildMspdi(doc));
    expect(findTask(reparsed, "2").ActualStart).toBe("2026-06-16T00:00:00");
    expect(String(findTask(reparsed, "2").PercentComplete)).toBe("50");
    // an untouched task is unchanged
    expect(String(findTask(reparsed, "1").PercentComplete)).toBe("100");
  });
});
