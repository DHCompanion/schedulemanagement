import { describe, it, expect } from "vitest";
import {
  scoreLogic,
  type LogicActivity,
  type LogicRelationship,
  type LogicMetricKey,
  type LogicScore,
} from "@/lib/health/logicChecks";

const d = (s: string) => new Date(s);
const DAY = 480;

function act(uid: number, overrides: Partial<LogicActivity> = {}): LogicActivity {
  return {
    externalUid: uid,
    type: "task",
    isActive: true,
    isMilestone: false,
    durationMinutes: 5 * DAY,
    totalSlackMinutes: 0,
    constraintType: 0,
    actualStart: null,
    actualFinish: null,
    ...overrides,
  };
}

function rel(pred: number, succ: number, overrides: Partial<LogicRelationship> = {}): LogicRelationship {
  return { predecessorExternalUid: pred, successorExternalUid: succ, type: "FS", lagMinutes: 0, ...overrides };
}

/** A clean FS chain 1 → 2 → … → n. */
function chain(n: number): { activities: LogicActivity[]; relationships: LogicRelationship[] } {
  const activities = Array.from({ length: n }, (_, i) => act(i + 1));
  const relationships = Array.from({ length: n - 1 }, (_, i) => rel(i + 1, i + 2));
  return { activities, relationships };
}

function metric(score: LogicScore, key: LogicMetricKey) {
  const m = score.metrics.find((x) => x.key === key);
  if (!m) throw new Error(`metric ${key} missing`);
  return m;
}

describe("scoreLogic", () => {
  it("passes every metric on a clean FS chain", () => {
    const { activities, relationships } = chain(5);
    const s = scoreLogic(activities, relationships, DAY);
    expect(s.metrics.every((m) => m.pass)).toBe(true);
    expect(s.score).toBe(1);
    expect(s.benchmarkEligible).toBe(true);
  });

  it("does not count the chain's open start and finish as missing logic", () => {
    const { activities, relationships } = chain(5);
    expect(metric(scoreLogic(activities, relationships, DAY), "missing_logic").count).toBe(0);
  });

  it("fails missing logic for an orphan and makes the import ineligible even when everything else passes", () => {
    const { activities, relationships } = chain(10);
    activities.push(act(99));
    const s = scoreLogic(activities, relationships, DAY);
    const m = metric(s, "missing_logic");
    expect(m.count).toBe(1);
    expect(m.pass).toBe(false);
    expect(s.metrics.filter((x) => x.key !== "missing_logic").every((x) => x.pass)).toBe(true);
    expect(s.benchmarkEligible).toBe(false);
  });

  it("counts a second open start beyond the one allowed", () => {
    const { activities, relationships } = chain(4);
    activities.push(act(10));
    relationships.push(rel(10, 3));
    expect(metric(scoreLogic(activities, relationships, DAY), "missing_logic").count).toBe(1);
  });

  it("ignores relationships to summaries when judging logic", () => {
    const { activities, relationships } = chain(3);
    activities.push(act(50, { type: "summary" }));
    relationships.push(rel(50, 1));
    const s = scoreLogic(activities, relationships, DAY);
    expect(metric(s, "missing_logic").count).toBe(0);
    expect(metric(s, "leads").denominator).toBe(2);
  });

  it("fails leads on any negative lag", () => {
    const { activities, relationships } = chain(5);
    relationships[0].lagMinutes = -DAY;
    const m = metric(scoreLogic(activities, relationships, DAY), "leads");
    expect(m.count).toBe(1);
    expect(m.pass).toBe(false);
  });

  it("fails lags above 5% of relationships", () => {
    const { activities, relationships } = chain(5);
    relationships[1].lagMinutes = 2 * DAY;
    const m = metric(scoreLogic(activities, relationships, DAY), "lags");
    expect(m.count).toBe(1);
    expect(m.pct).toBe(0.25);
    expect(m.pass).toBe(false);
  });

  it("fails non-FS above 10% of relationships", () => {
    const { activities, relationships } = chain(5);
    relationships[2].type = "SS";
    expect(metric(scoreLogic(activities, relationships, DAY), "non_fs").pass).toBe(false);
  });

  it("fails hard constraints at 1 MSO in 10", () => {
    const { activities, relationships } = chain(10);
    activities[4].constraintType = 2;
    const m = metric(scoreLogic(activities, relationships, DAY), "hard_constraints");
    expect(m.count).toBe(1);
    expect(m.pass).toBe(false);
  });

  it("treats soft constraints (SNET, FNET, ALAP) as fine", () => {
    const { activities, relationships } = chain(10);
    activities[1].constraintType = 4;
    activities[2].constraintType = 6;
    activities[3].constraintType = 1;
    expect(metric(scoreLogic(activities, relationships, DAY), "hard_constraints").count).toBe(0);
  });

  it("converts float and duration with the import's minutes per day", () => {
    const { activities, relationships } = chain(10);
    activities[3].totalSlackMinutes = 45 * 480;
    activities[4].durationMinutes = 45 * 480;
    const at480 = scoreLogic(activities, relationships, 480);
    expect(metric(at480, "high_float").count).toBe(1);
    expect(metric(at480, "high_duration").count).toBe(1);
    const at600 = scoreLogic(activities, relationships, 600);
    expect(metric(at600, "high_float").count).toBe(0);
    expect(metric(at600, "high_duration").count).toBe(0);
  });

  it("exempts milestones from high duration", () => {
    const { activities, relationships } = chain(3);
    activities[1].isMilestone = true;
    activities[1].durationMinutes = 100 * DAY;
    expect(metric(scoreLogic(activities, relationships, DAY), "high_duration").count).toBe(0);
  });

  it("fails negative float on any activity", () => {
    const { activities, relationships } = chain(5);
    activities[2].totalSlackMinutes = -DAY;
    expect(metric(scoreLogic(activities, relationships, DAY), "negative_float").pass).toBe(false);
  });

  it("counts a started successor whose FS predecessor is unfinished as out of sequence", () => {
    const { activities, relationships } = chain(3);
    activities[0].actualStart = d("2026-03-02");
    activities[1].actualStart = d("2026-03-04");
    const m = metric(scoreLogic(activities, relationships, DAY), "out_of_sequence");
    expect(m.count).toBe(1);
    expect(m.denominator).toBe(1);
  });

  it("counts a successor that started before its predecessor finished as out of sequence", () => {
    const { activities, relationships } = chain(3);
    activities[0].actualStart = d("2026-03-02");
    activities[0].actualFinish = d("2026-03-10");
    activities[1].actualStart = d("2026-03-05");
    expect(metric(scoreLogic(activities, relationships, DAY), "out_of_sequence").count).toBe(1);
  });

  it("excludes out of sequence from the total when nothing has started", () => {
    const { activities, relationships } = chain(5);
    const s = scoreLogic(activities, relationships, DAY);
    expect(s.total).toBe(8);
    expect(s.passed).toBe(8);
  });

  it("ignores summaries and inactive activities everywhere", () => {
    const { activities, relationships } = chain(5);
    activities.push(act(60, { type: "summary", constraintType: 2, totalSlackMinutes: -DAY }));
    activities.push(act(61, { isActive: false, durationMinutes: 200 * DAY }));
    const s = scoreLogic(activities, relationships, DAY);
    expect(s.metrics.every((m) => m.pass)).toBe(true);
    expect(metric(s, "missing_logic").denominator).toBe(5);
  });

  it("is ineligible below the minimum score even when logic passes", () => {
    const { activities, relationships } = chain(10);
    relationships.forEach((r) => (r.type = "SS"));
    relationships[0].lagMinutes = -DAY;
    relationships[1].lagMinutes = DAY;
    activities[0].constraintType = 2;
    activities[1].totalSlackMinutes = -DAY;
    const s = scoreLogic(activities, relationships, DAY);
    expect(metric(s, "missing_logic").pass).toBe(true);
    expect(s.score).toBeLessThan(0.6);
    expect(s.benchmarkEligible).toBe(false);
  });
});
