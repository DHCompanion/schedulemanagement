import { describe, it, expect } from "vitest";
import { mondayOfWeek, bucketOf, groupIntoBuckets, bucketLabel, fmtShortDate, BUCKET_ORDER } from "@/lib/schedule/weekBuckets";

// Mon Aug 3 2026. asOf mid-week Wednesday to prove week alignment.
const asOf = new Date("2026-08-05T12:00:00Z");
const row = (over: Partial<Parameters<typeof bucketOf>[0]> = {}) => ({
  status: "not_started" as const, expectedStart: null, expectedFinish: null, ...over,
});

describe("mondayOfWeek", () => {
  it("maps any weekday to that week's UTC Monday", () => {
    expect(mondayOfWeek(asOf).toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(mondayOfWeek(new Date("2026-08-09T23:00:00Z")).toISOString()).toBe("2026-08-03T00:00:00.000Z"); // Sunday belongs to the Monday-started week
    expect(mondayOfWeek(new Date("2026-08-03T00:00:00Z")).toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });
});

describe("bucketOf", () => {
  it("complete goes to done regardless of dates", () => {
    expect(bucketOf(row({ status: "complete", expectedStart: "2026-09-01T08:00:00Z" }), asOf)).toBe("done");
  });
  it("in progress is always this week — it is active now", () => {
    expect(bucketOf(row({ status: "in_progress", expectedStart: "2026-09-01T08:00:00Z" }), asOf)).toBe("thisWeek");
  });
  it("buckets not-started by expected start against Monday-based weeks", () => {
    expect(bucketOf(row({ expectedStart: "2026-08-07T08:00:00Z" }), asOf)).toBe("thisWeek");   // Fri this week
    expect(bucketOf(row({ expectedStart: "2026-08-10T08:00:00Z" }), asOf)).toBe("nextWeek");   // next Mon
    expect(bucketOf(row({ expectedStart: "2026-08-17T08:00:00Z" }), asOf)).toBe("weeks3to6");  // week 3
    expect(bucketOf(row({ expectedStart: "2026-09-11T08:00:00Z" }), asOf)).toBe("weeks3to6");  // week 6
    expect(bucketOf(row({ expectedStart: "2026-09-14T08:00:00Z" }), asOf)).toBe("later");      // week 7
  });
  it("an overdue not-started activity surfaces in this week", () => {
    expect(bucketOf(row({ expectedStart: "2026-07-20T08:00:00Z" }), asOf)).toBe("thisWeek");
  });
  it("no dates lands in later", () => {
    expect(bucketOf(row(), asOf)).toBe("later");
  });
});

describe("groupIntoBuckets", () => {
  it("returns every bucket key with rows in input order", () => {
    const rows = [
      row({ status: "complete" }),
      row({ expectedStart: "2026-08-06T08:00:00Z" }),
      row({ expectedStart: "2026-08-12T08:00:00Z" }),
    ];
    const g = groupIntoBuckets(rows, asOf);
    expect(Object.keys(g).sort()).toEqual([...BUCKET_ORDER].sort());
    expect(g.done.length).toBe(1);
    expect(g.thisWeek.length).toBe(1);
    expect(g.nextWeek.length).toBe(1);
    expect(g.weeks3to6.length).toBe(0);
  });
});

describe("labels", () => {
  it("renders Monday-Sunday ranges and short dates in UTC", () => {
    expect(bucketLabel("thisWeek", asOf)).toBe("This week · Aug 3–9");
    expect(bucketLabel("nextWeek", asOf)).toBe("Next week · Aug 10–16");
    expect(bucketLabel("weeks3to6", asOf)).toBe("Weeks 3–6 · Aug 17–Sep 13");
    expect(bucketLabel("later", asOf)).toBe("Later");
    expect(bucketLabel("done", asOf)).toBe("Done");
    expect(fmtShortDate("2026-08-07T17:00:00Z")).toBe("Aug 7");
  });
});
