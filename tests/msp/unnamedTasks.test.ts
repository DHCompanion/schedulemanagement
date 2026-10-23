import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMspXml } from "@/lib/msp/parseMspXml";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");

// MPXJ's .mpp conversion keeps nameless tasks that MS Project's own XML save drops.
const unnamed = `<Task><UID>50</UID><ID>50</ID><WBS>9</WBS><OutlineNumber>9</OutlineNumber><OutlineLevel>1</OutlineLevel>
  <Type>1</Type><Milestone>0</Milestone><Summary>0</Summary><IsNull>0</IsNull>
  <Start>2025-06-03T08:00:00</Start><Finish>2025-06-04T17:00:00</Finish><Duration>PT16H0M0S</Duration></Task>`;

describe("parseMspXml unnamed tasks", () => {
  it("skips a nameless leaf task and says so", () => {
    const base = parseMspXml(xml);
    const parsed = parseMspXml(xml.replace("</Tasks>", `${unnamed}</Tasks>`));
    expect(parsed.activities.map((a) => a.externalUid)).toEqual(base.activities.map((a) => a.externalUid));
    expect(parsed.warnings).toContain("Skipped 1 task with no name.");
  });
});
