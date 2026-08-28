import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseMspXml } from "@/lib/msp/parseMspXml";
import { buildMspdi } from "../../demo/mspdi";

const storyPath = process.env.DEMO_STORY_PATH ?? "/home/awoodyard/workspace/skiles-group-connect-v1/.claude/worktrees/demo/demo/story.json";
const anchor = new Date(Date.UTC(2026, 8, 7)); // a Monday

describe.skipIf(!existsSync(storyPath))("buildMspdi", () => {
  let story: any;
  beforeAll(() => {
    story = JSON.parse(readFileSync(storyPath, "utf8"));
  });

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
    for (const a of story.activities) {
      for (const p of a.predecessors) {
        const rel = parsed.relationships.find((r) => r.successorExternalUid === a.uid && r.predecessorExternalUid === p.uid)!;
        expect(rel).toBeDefined();
        expect(rel.type).toBe(p.type);
        expect(rel.lagMinutes).toBe(p.lagDays * 480);
      }
    }
    // uid 6 "Underground plumbing" has a -3 day lag on its predecessor — confirm negative lag round-trips.
    const negLag = parsed.relationships.find((r) => r.successorExternalUid === 6 && r.predecessorExternalUid === 5)!;
    expect(negLag.lagMinutes).toBe(-3 * 480);
    expect(parsed.header.statusDate).toBeNull();
    expect(parsed.activities.some((a) => a.baselineStart)).toBe(false);
  });
  it("maps an SS predecessor to parsed type SS", () => {
    const ssStory = {
      project: { name: "SS Test", number: "SS-1", startOffset: 0, finishOffset: 5 },
      activities: [
        { uid: 0, wbs: "1", name: "A", level: 0, parentUid: null, summary: false, milestone: false, critical: false, startOffset: 0, durationDays: 3, predecessors: [] },
        { uid: 1, wbs: "2", name: "B", level: 0, parentUid: null, summary: false, milestone: false, critical: false, startOffset: 0, durationDays: 3, predecessors: [{ uid: 0, type: "SS", lagDays: 0 }] },
      ],
    };
    const parsed = parseMspXml(buildMspdi(ssStory, anchor, null));
    const rel = parsed.relationships.find((r) => r.successorExternalUid === 1 && r.predecessorExternalUid === 0)!;
    expect(rel.type).toBe("SS");
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
