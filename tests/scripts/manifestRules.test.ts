import { describe, it, expect } from "vitest";
import { nameStem, placeFiles, type ManifestFile } from "@/scripts/manifestRules";

function f(file: string, lastSaved: string, over: Partial<ManifestFile> = {}): ManifestFile {
  return { file, sha256: file, creationDate: "2020-05-01T00:49:00", lastSaved, error: null, ...over };
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

  it("always flags groups made by name because the file had no creation date", () => {
    const p = placeFiles([f("Parker South 1.mpp", "2020-05-02T10:00:00", { creationDate: null })]);
    expect(p.get("Parker South 1.mpp")?.checkGrouping).toBe(true);
  });

  it("skips failed conversions with the error as the reason", () => {
    const p = placeFiles([f("bad.mpp", "", { error: "unreadable" })]);
    expect(p.get("bad.mpp")).toMatchObject({ keep: false, reason: "conversion failed: unreadable" });
  });
});
