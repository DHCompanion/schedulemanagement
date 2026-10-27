import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE } from "@/lib/auth";
import { signSession } from "@/lib/scope";
import { planSuggestions, summarizeBacklog, type BacklogRow } from "@/lib/normalize/nameBacklog";

const row = (normalizedName: string, taskCount: number, over: Partial<BacklogRow> = {}): BacklogRow => ({
  normalizedName, rawName: normalizedName, taskCount, projectCount: 1, samples: [], kind: "map", suggestion: "Paint",
  covers: [], confidence: "high", reason: "", source: "ai", poolTasks: 100, ...over,
});

describe("summarizeBacklog", () => {
  it("keeps unsettled names, most tasks first, and measures coverage against the pool", () => {
    const { rows, progress } = summarizeBacklog([row("a", 5), row("b", 20), row("c", 10, { confidence: "low" })], (n) => n === "b", 10);
    expect(rows.map((r) => r.normalizedName)).toEqual(["c", "a"]);
    // 100 pool tasks, 15 still unsettled: 85% covered.
    expect(progress).toEqual({ names: 3, settledNames: 1, poolTasks: 100, coverage: 0.85, high: 1 });
  });
  it("returns only the first page", () => {
    expect(summarizeBacklog([row("a", 5), row("b", 4)], () => false, 1).rows).toHaveLength(1);
  });
});

describe("planSuggestions", () => {
  const known = ["Paint", "Install Drywall"];
  const input = (over: Record<string, unknown>) => ({ normalizedName: "x", rawName: "X", taskCount: 1, projectCount: 1, samples: [], poolTasks: 10, kind: "map", suggestion: "Paint", confidence: "high", reason: "r", ...over });
  it("keeps valid suggestions and turns a map to an unlisted name into a proposed new name", () => {
    const [ok, unlisted] = planSuggestions([input({}), input({ normalizedName: "y", suggestion: "Hang Wallpaper" })], known);
    expect(ok).toMatchObject({ kind: "map", suggestion: "Paint", source: "ai" });
    expect(unlisted).toMatchObject({ kind: "new", suggestion: "Hang Wallpaper" });
    // No suggestion at all stays a map with nothing to approve.
    expect(planSuggestions([input({ suggestion: "" })], known)[0]).toMatchObject({ kind: "map", suggestion: "" });
  });
  it("keeps only listed names in coarse covers and refuses unknown kinds or confidences", () => {
    expect(planSuggestions([input({ kind: "coarse", suggestion: "", covers: ["Paint", "Nope"] })], known)[0].covers).toEqual(["Paint"]);
    expect(() => planSuggestions([input({ kind: "guess" })], known)).toThrow(/kind/);
    expect(() => planSuggestions([input({ confidence: "sure" })], known)).toThrow(/confidence/);
  });
});

describe.runIf(!!process.env.DATABASE_URL)("name backlog with a database", () => {
  const tag = `zb${Date.now()}`;
  const now = () => Math.floor(Date.now() / 1000);
  beforeEach(() => {
    process.env.SESSION_SIGNING_SECRET = "n".repeat(32);
  });
  afterAll(async () => {
    for (const t of [prisma.scopeNameSuggestion, prisma.scopeDictionaryEntry, prisma.scopeIgnoredName, prisma.scopeNameClass] as const)
      await (t as typeof prisma.scopeIgnoredName).deleteMany({ where: { normalizedName: { contains: tag } } });
    await prisma.standardScope.deleteMany({ where: { name: { contains: tag } } });
    await prisma.$disconnect();
  });

  async function call(method: "GET" | "POST", body?: unknown, admin = true) {
    const route = await import("@/app/api/history/names/backlog/route");
    const cookie = `${SESSION_COOKIE}=${await signSession(admin, now())}`;
    const req = new Request("http://localhost/api/history/names/backlog", { method, headers: { Cookie: cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return method === "GET" ? route.GET(req) : route.POST(req);
  }

  it("serves the backlog and settles names through each action, for admins only", async () => {
    await prisma.standardScope.createMany({ data: [{ name: `Paint ${tag}` }, { name: `Frame ${tag}` }] });
    const s = (n: string, over: Record<string, unknown> = {}) => ({
      // Huge counts keep these first even if the table holds other names.
      normalizedName: `${n} ${tag}`, rawName: `${n} ${tag}`, taskCount: 1_000_000, projectCount: 1, samples: [], kind: "map", suggestion: `Paint ${tag}`,
      covers: [], confidence: "low", reason: "", source: "ai", poolTasks: 50, ...over,
    });
    await prisma.scopeNameSuggestion.createMany({ data: [s("paint walls", { taskCount: 1_000_009, confidence: "high" }), s("prime walls"), s("mob and icra"), s("vavs"), s("buffer"), s("wallpaper"), s("framing", { confidence: "high", suggestion: `Frame ${tag}` })] });

    expect((await call("GET", undefined, false)).status).toBe(403);
    const got = await (await call("GET")).json();
    expect(got.rows.filter((r: BacklogRow) => r.normalizedName.includes(tag))[0].normalizedName).toBe(`paint walls ${tag}`);

    expect((await call("POST", { name: `prime walls ${tag}`, action: "map", scope: `Paint ${tag}` })).status).toBe(200);
    expect((await call("POST", { name: `mob and icra ${tag}`, action: "coarse", covers: [`Paint ${tag}`] })).status).toBe(200);
    expect((await call("POST", { name: `vavs ${tag}`, action: "procurement" })).status).toBe(200);
    expect((await call("POST", { name: `buffer ${tag}`, action: "ignore" })).status).toBe(200);
    expect((await call("POST", { name: `wallpaper ${tag}`, action: "new", scope: `Hang Wallpaper ${tag}` })).status).toBe(200);
    expect((await call("POST", { name: `x ${tag}`, action: "map", scope: `Unlisted ${tag}` })).status).toBe(422);
    expect((await call("POST", { name: `x ${tag}`, action: "explode" })).status).toBe(422);

    const dict = await prisma.scopeDictionaryEntry.findMany({ where: { normalizedName: { contains: tag } }, orderBy: { normalizedName: "asc" } });
    expect(dict.map((d) => [d.normalizedName, d.canonicalScope])).toEqual([[`prime walls ${tag}`, `Paint ${tag}`], [`wallpaper ${tag}`, `Hang Wallpaper ${tag}`]]);
    expect(await prisma.scopeNameClass.findUnique({ where: { normalizedName: `mob and icra ${tag}` } })).toMatchObject({ kind: "coarse", covers: [`Paint ${tag}`] });
    expect(await prisma.scopeNameClass.findUnique({ where: { normalizedName: `vavs ${tag}` } })).toMatchObject({ kind: "procurement" });
    expect(await prisma.scopeIgnoredName.findUnique({ where: { normalizedName: `buffer ${tag}` } })).not.toBeNull();

    // Approve all high-confidence: the two left that are high, each mapped to its listed suggestion.
    expect(await (await call("POST", { approveHigh: true })).json()).toMatchObject({ approved: expect.any(Number) });
    expect(await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: `paint walls ${tag}` } })).toMatchObject({ canonicalScope: `Paint ${tag}` });
    expect(await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: `framing ${tag}` } })).toMatchObject({ canonicalScope: `Frame ${tag}` });
    const left = (await (await call("GET")).json()).rows.filter((r: BacklogRow) => r.normalizedName.includes(tag));
    expect(left).toEqual([]);
  });
});
