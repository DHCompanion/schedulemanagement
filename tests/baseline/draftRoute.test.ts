import { describe, it, expect } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth";
import { signSession } from "@/lib/scope";
import { readDraftQuery } from "@/lib/baseline/draftInputs";

describe("readDraftQuery", () => {
  it("reads type, a valid start date and distinct non-blank names", () => {
    const q = readDraftQuery(new URLSearchParams("type=Clinic&start=2026-11-02&scope=Frame+Walls&scope=&scope=Frame+Walls&scope=Paint"));
    expect(q).toEqual({ type: "Clinic", subType: "", start: new Date("2026-11-02T00:00:00Z"), scopes: ["Frame Walls", "Paint"] });
    expect(readDraftQuery(new URLSearchParams("type=Imaging+%26+Radiology&sub=MRI")).subType).toBe("MRI");
    expect(readDraftQuery(new URLSearchParams("start=11/02/2026")).start).toBeNull();
  });
});

describe.runIf(!!process.env.DATABASE_URL)("draft baseline route (db)", () => {
  process.env.SESSION_SIGNING_SECRET = process.env.SESSION_SIGNING_SECRET || "token-abc".padEnd(32, "x");
  it("refuses non-admins, and explains an unusable request", async () => {
    const { GET } = await import("@/app/api/history/draft-baseline/route");
    const url = "http://localhost/api/history/draft-baseline?type=Nope&start=2026-11-02&scope=Paint";
    expect((await GET(new Request(url))).status).toBe(403);
    const headers = { Cookie: `${SESSION_COOKIE}=${await signSession(true, Math.floor(Date.now() / 1000))}` };
    const bad = await GET(new Request(url, { headers }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.message).toMatch(/Unknown project type/);
    expect((await GET(new Request("http://localhost/api/history/draft-baseline?type=Clinic", { headers }))).status).toBe(422);
    const sub = await GET(new Request("http://localhost/api/history/draft-baseline?type=Clinic&sub=MRI&start=2026-11-02&scope=Paint", { headers }));
    expect((await sub.json()).error.message).toMatch(/isn't a subtype of Clinic/);
  });
});
