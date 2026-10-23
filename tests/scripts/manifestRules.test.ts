import { describe, it, expect } from "vitest";
import { backfillPlan, nameStem, placeFiles, type ManifestFile } from "@/scripts/manifestRules";

function f(file: string, lastSaved: string, over: Partial<ManifestFile> = {}): ManifestFile {
  return { file, title: file, project: null, reviewerSkip: false, sha256: file, creationDate: "2020-05-01T00:49:00", lastSaved, error: null, ...over };
}

describe("nameStem", () => {
  it("drops dates, numbers and filler words", () => {
    expect(nameStem("2020/Parker University Site Redevelopment 5.17.mpp")).toBe("parker university site redevelopment");
    expect(nameStem("20210716 Landry Center Refresh Master Schedule.mpp")).toBe("landry center refresh master");
  });
});

describe("placeFiles", () => {
  it("keeps earliest, latest and the last save of each month between", () => {
    const p = placeFiles([
      f("a 5.02", "2020-05-02T10:00:00"),
      f("a 5.20", "2020-05-20T10:00:00"),
      f("a 6.03", "2020-06-03T10:00:00"),
      f("a 6.28", "2020-06-28T10:00:00"),
      f("a 7.01", "2020-07-01T10:00:00"),
    ]);
    const kept = [...p].filter(([, v]) => v.keep).map(([k]) => k);
    expect(kept).toEqual(["a 5.02", "a 5.20", "a 6.28", "a 7.01"]);
    expect(p.get("a 6.03")?.reason).toBe("superseded within its month");
    expect(p.get("a 5.02")?.reason).toBe("earliest version");
  });

  it("separates jobs by creation date", () => {
    const p = placeFiles([f("x", "2020-05-02T10:00:00"), f("y", "2020-05-03T10:00:00", { creationDate: "2019-01-01T00:00:00" })]);
    expect(p.get("x")?.group).not.toBe(p.get("y")?.group);
    expect(p.get("y")?.reason).toBe("only version");
  });

  it("skips exact duplicates", () => {
    const p = placeFiles([f("a", "2020-05-02T10:00:00", { sha256: "same" }), f("a copy", "2020-05-09T10:00:00", { sha256: "same" })]);
    expect(p.get("a copy")).toMatchObject({ keep: false, reason: "duplicate of a" });
  });

  it("flags a group whose file names don't look alike", () => {
    const p = placeFiles([f("Parker South 1.mpp", "2020-05-02T10:00:00"), f("Electra Phase 2.mpp", "2020-06-02T10:00:00")]);
    expect(p.get("Parker South 1.mpp")?.checkGrouping).toBe(true);
  });

  it("splits files that share a creation date but not a name (a job started from another job's file)", () => {
    const created = "2020-01-01T00:00:00";
    const p = placeFiles([
      f("Santa Fe MOB Master 1.mpp", "2022-05-02T10:00:00", { creationDate: created, title: "Santa Fe MOB" }),
      f("Santa Fe MOB Master 2.mpp", "2022-06-02T10:00:00", { creationDate: created, title: "Santa Fe MOB" }),
      f("Coryell Health Clinic 10.19.mpp", "2025-10-19T10:00:00", { creationDate: created, title: "Santa Fe MOB" }),
    ]);
    expect(p.get("Santa Fe MOB Master 1.mpp")?.group).toBe(p.get("Santa Fe MOB Master 2.mpp")?.group);
    expect(p.get("Coryell Health Clinic 10.19.mpp")?.group).not.toBe(p.get("Santa Fe MOB Master 1.mpp")?.group);
    expect(p.get("Coryell Health Clinic 10.19.mpp")).toMatchObject({ reason: "only version", checkGrouping: true });
  });

  it("keeps conflict copies and generic names with their job when splitting", () => {
    const created = "2020-01-01T00:00:00";
    const p = placeFiles([
      f("D2 Admin Renovations.mpp", "2022-05-02T10:00:00", { creationDate: created }),
      f("D2 Admin Renovations (conflict copy from a@b.com).mpp", "2022-05-03T10:00:00", { creationDate: created }),
      f("Schedule DD 2.3.22.mpp", "2022-05-04T10:00:00", { creationDate: created }),
      f("Coryell Clinic.mpp", "2022-06-04T10:00:00", { creationDate: created }),
    ]);
    const g = p.get("D2 Admin Renovations.mpp")?.group;
    expect(p.get("D2 Admin Renovations (conflict copy from a@b.com).mpp")?.group).toBe(g);
    expect(p.get("Schedule DD 2.3.22.mpp")?.group).toBe(g);
    expect(p.get("Coryell Clinic.mpp")?.group).not.toBe(g);
  });

  it("always flags groups made by name because the file had no creation date", () => {
    const p = placeFiles([f("Parker South 1.mpp", "2020-05-02T10:00:00", { creationDate: null })]);
    expect(p.get("Parker South 1.mpp")?.checkGrouping).toBe(true);
  });

  it("regroups by the reviewer's project names and recomputes keep/skip per project", () => {
    const p = placeFiles([
      f("WCWH 1", "2020-05-02T10:00:00", { project: "WCWH Pharmacy" }),
      f("WCWH 2", "2020-05-10T10:00:00", { project: "WCWH Pharmacy" }),
      f("Laredo 1", "2020-05-05T10:00:00", { project: "Laredo Pharmacy" }),
    ]);
    expect(p.get("WCWH 1")).toMatchObject({ group: "WCWH Pharmacy", keep: true, reason: "earliest version", checkGrouping: false });
    expect(p.get("WCWH 2")?.reason).toBe("latest version");
    expect(p.get("Laredo 1")).toMatchObject({ group: "Laredo Pharmacy", reason: "only version" });
  });

  it("merges a row into another job when its project names that job's proposed group", () => {
    const p = placeFiles([
      f("Landry 1", "2020-05-02T10:00:00", { title: "Landry Center", creationDate: "2020-01-01T00:00:00" }),
      f("Landry 2", "2020-07-02T10:00:00", { title: "Landry Center", creationDate: "2020-01-01T00:00:00" }),
      f("Landry stray", "2020-06-02T10:00:00", { title: "Landry old", creationDate: null, project: "Landry Center" }),
    ]);
    expect(new Set([...p.values()].map((v) => v.group))).toEqual(new Set(["Landry Center"]));
    expect(p.get("Landry 1")?.reason).toBe("earliest version");
    expect(p.get("Landry stray")?.reason).toBe("last save of 2020-06");
    expect(p.get("Landry 2")?.reason).toBe("latest version");
  });

  it("honours a reviewer's skip and picks earliest/latest from what's left", () => {
    const p = placeFiles([
      f("a 5.02", "2020-05-02T10:00:00"),
      f("a 6.10", "2020-06-10T10:00:00"),
      f("a 7.01", "2020-07-01T10:00:00", { reviewerSkip: true }),
    ]);
    expect(p.get("a 7.01")).toMatchObject({ keep: false, reason: "skipped by reviewer" });
    expect(p.get("a 6.10")?.reason).toBe("latest version");
  });

  it("names a proposed group after its latest file's title", () => {
    const p = placeFiles([f("a", "2020-05-02T10:00:00", { title: "Old" }), f("b", "2020-06-02T10:00:00", { title: "Parker South" })]);
    expect(p.get("a")?.group).toBe("Parker South");
  });

  it("names a group after the file, not a title that is a file path", () => {
    const p = placeFiles([f("2023/OR7 Schedule.mpp", "2020-05-02T10:00:00", { title: "\\\\EgnyteDrive\\Jobs\\OR7 Schedule" })]);
    expect(p.get("2023/OR7 Schedule.mpp")?.group).toBe("OR7 Schedule");
  });

  it("skips failed conversions with the error as the reason", () => {
    const p = placeFiles([f("bad.mpp", "", { error: "unreadable" })]);
    expect(p.get("bad.mpp")).toMatchObject({ keep: false, reason: "conversion failed: unreadable" });
  });
});

describe("backfillPlan", () => {
  const row = (file: string, lastSaved: string, over: Record<string, string> = {}) => ({ file, group: "Job", keep: "yes", kind: "master", lastSaved, ...over });

  it("imports kept rows oldest first with the earliest master file as baseline", () => {
    const [job] = backfillPlan([
      row("late", "2020-07-01T00:00:00"),
      row("pull plan", "2020-04-01T00:00:00", { kind: "short-term" }),
      row("early", "2020-05-01T00:00:00"),
      row("skipped", "2020-06-01T00:00:00", { keep: "no" }),
    ]);
    expect(job.files).toEqual([
      { file: "pull plan", isBaseline: false, tierOverride: "rough" },
      { file: "early", isBaseline: true, tierOverride: null },
      { file: "late", isBaseline: false, tierOverride: null },
    ]);
  });

  it("ignores rows with no group (failed conversions) and accepts YES in any case", () => {
    expect(backfillPlan([row("x", "", { group: "" }), row("y", "", { keep: "YES" })]).map((p) => p.files.length)).toEqual([1]);
  });
});
