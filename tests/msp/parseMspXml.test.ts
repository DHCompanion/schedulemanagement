import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseMspXml } from "@/lib/msp/parseMspXml";

const xml = readFileSync(resolve(__dirname, "../fixtures/minimal.xml"), "utf8");

describe("parseMspXml (minimal fixture)", () => {
  const result = parseMspXml(xml);

  it("reads the header", () => {
    expect(result.header.titleFromFile).toBe("Minimal Test Schedule");
    expect(result.header.statusDate).toBe("2025-06-05T17:00:00");
    expect(result.header.minutesPerDay).toBe(480);
  });

  it("maps the custom field alias", () => {
    expect(result.fieldDefinitions[0].alias).toBe("Phoenix ID");
  });

  it("skips IsNull tasks and counts the rest", () => {
    expect(result.activities.find((a) => a.externalUid === 99)).toBeUndefined();
    expect(result.counts.activities).toBe(4);
    expect(result.counts.milestones).toBe(1);
  });

  it("classifies types", () => {
    expect(result.activities.find((a) => a.externalUid === 0)?.type).toBe("project_summary");
    expect(result.activities.find((a) => a.externalUid === 3)?.type).toBe("milestone");
    expect(result.activities.find((a) => a.externalUid === 2)?.type).toBe("task");
  });

  it("normalizes durations and slack", () => {
    const elec = result.activities.find((a) => a.externalUid === 2)!;
    expect(elec.durationMinutes).toBe(1440);
    expect(elec.durationDays).toBe(3);
    expect(elec.totalSlackMinutes).toBe(480);
  });

  it("captures custom field values by alias", () => {
    const mob = result.activities.find((a) => a.externalUid === 1)!;
    expect(mob.customFields["Phoenix ID"]).toBe("PX-1");
    expect(mob.baselineStart).toBe("2025-06-03T08:00:00");
  });

  it("builds relationships with mapped type and lag", () => {
    expect(result.counts.relationships).toBe(2);
    const toMilestone = result.relationships.find((r) => r.successorExternalUid === 3)!;
    expect(toMilestone.type).toBe("FS");
    expect(toMilestone.lagMinutes).toBe(480);
  });
});

const realPath = resolve(__dirname, "../fixtures/cath-ir-baseline.xml");

describe.runIf(existsSync(realPath))("parseMspXml (real Cath IR export)", () => {
  const real = parseMspXml(readFileSync(realPath, "utf8"));
  it("parses the expected real-world shape", () => {
    expect(real.header.statusDate).toBe("2026-01-30T17:00:00");
    expect(real.activities.length).toBeGreaterThan(250);
    expect(real.relationships.length).toBeGreaterThan(100);
    expect(real.fieldDefinitions.some((f) => f.alias === "Phoenix ID")).toBe(true);
    expect(real.activities.every((a) => a.canonicalActivityKey.length > 0)).toBe(true);
  });
});
