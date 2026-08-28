import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMspXml } from "@/lib/msp/parseMspXml";
import { buildMspdi } from "../../demo/mspdi";

const story = JSON.parse(readFileSync(process.env.DEMO_STORY_PATH ?? "/home/awoodyard/workspace/skiles-group-connect-v1/.claude/worktrees/demo/demo/story.json", "utf8"));
const anchor = new Date(Date.UTC(2026, 8, 7)); // a Monday

describe("buildMspdi", () => {
  it("round-trips every activity with the story's canonical key", () => {
    const parsed = parseMspXml(buildMspdi(story, anchor, null));
    expect(parsed.activities.length).toBe(story.activities.length);
    for (const a of story.activities) {
      const p = parsed.activities.find((x) => x.externalUid === a.uid)!;
      expect(p.canonicalActivityKey).toBe(a.key);
      expect(p.type).toBe(a.level === 0 ? "project_summary" : a.summary ? "summary" : a.milestone ? "milestone" : "task");
      expect(p.isCritical).toBe(a.critical);
    }
    expect(parsed.relationships.length).toBe(story.activities.reduce((n, a) => n + a.predecessors.length, 0));
    expect(parsed.header.statusDate).toBeNull();
    expect(parsed.activities.some((a) => a.baselineStart)).toBe(false);
  });
  it("status update carries actuals before the status date and baseline 0", () => {
    const parsed = parseMspXml(buildMspdi(story, anchor, -7));
    expect(parsed.header.statusDate).toBe("2026-08-31T17:00:00");
    const past = parsed.activities.find((a) => a.type === "task" && a.plannedFinish! < "2026-08-31")!;
    expect(past.percentComplete).toBe(100);
    expect(past.actualFinish).not.toBeNull();
    expect(past.baselineStart).not.toBeNull();
    const future = parsed.activities.find((a) => a.type === "task" && a.plannedStart! > "2026-09-30")!;
    expect(future.percentComplete).toBe(0);
  });
});
