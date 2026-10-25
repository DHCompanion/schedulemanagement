import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyDictionaryWith, buildDictionary, confirmMapping, getDictionary, getKnownScopes, applyDictionary, requestStandardScope, getNameStatus } from "@/lib/normalize/normalizationService";

describe("applyDictionaryWith (pure)", () => {
  it("splits mapped vs distinct unmapped names", () => {
    const dict = new Map([["electrical rough-in", "Electrical Rough-In"]]);
    const res = applyDictionaryWith(
      [{ name: "Electrical Rough-In" }, { name: "Electrical Rough-In" }, { name: "Mystery Task" }, { name: "Mystery Task" }],
      dict,
    );
    expect(res.mapped.length).toBe(2);
    expect(res.mapped[0].canonicalScope).toBe("Electrical Rough-In");
    expect(res.unmappedNames).toEqual(["Mystery Task"]); // deduped
  });
});

describe("buildDictionary (pure)", () => {
  it("maps a standard scope's own name to itself", () => {
    const dict = buildDictionary([{ normalizedName: "plumbing oh r/i", canonicalScope: "Plumbing Overhead Rough-In" }]);
    const res = applyDictionaryWith([{ name: "Plumbing Overhead Rough-In" }], dict);
    expect(res.unmappedNames).toEqual([]);
    expect(res.mapped[0].canonicalScope).toBe("Plumbing Overhead Rough-In");
  });
  it("maps an approved name with no entries to itself", () => {
    expect(buildDictionary([], ["Install Wall Protection"]).get("install wall protection")).toBe("Install Wall Protection");
  });
  it("lets an explicit entry win over the implied one", () => {
    const dict = buildDictionary([
      { normalizedName: "demo", canonicalScope: "Selective Demolition" },
      { normalizedName: "tear out", canonicalScope: "Demo" },
    ]);
    expect(dict.get("demo")).toBe("Selective Demolition");
  });
});

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("normalizationService (db)", () => {
  const made: string[] = [];
  const stamp = Date.now();
  const A = `Test Scope A ${stamp}`, B = `Test Scope B ${stamp}`, R = `Routed Scope ${stamp}`;
  beforeAll(async () => {
    await prisma.standardScope.createMany({ data: [A, B, R].map((name) => ({ name })) });
  });
  afterAll(async () => {
    if (made.length) {
      await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: { in: made } } });
      await prisma.scopeIgnoredName.deleteMany({ where: { normalizedName: { in: made } } });
      await prisma.standardScopeRequest.deleteMany({ where: { normalizedName: { in: made } } });
    }
    await prisma.standardScope.deleteMany({ where: { name: { in: [A, B, R] } } });
    await prisma.$disconnect();
  });

  it("refuses a scope that isn't on the standard list, and stores the listed spelling", async () => {
    const raw = `ZZ Strict ${stamp}`;
    made.push(raw.toLowerCase());
    await expect(confirmMapping(raw, `Not Listed ${stamp}`)).rejects.toThrow(/not on the standard name list/);
    await confirmMapping(raw, A.toUpperCase());
    expect((await getDictionary()).get(raw.toLowerCase())).toBe(A);
  }, 30000);

  it("mapping a name clears its ignore and its pending request", async () => {
    const raw = `ZZ Settle ${stamp}`;
    const key = raw.toLowerCase();
    made.push(key);
    await prisma.scopeIgnoredName.create({ data: { normalizedName: key } });
    await requestStandardScope(raw, { projectId: "p1", requestedBy: "Pat" });
    expect((await getNameStatus()).requested.has(key)).toBe(true);
    await confirmMapping(raw, A);
    const status = await getNameStatus();
    expect(status.settled.has(key)).toBe(false);
    expect(status.requested.has(key)).toBe(false);
  }, 30000);

  it("route answers 422 for an unlisted scope", async () => {
    const { POST } = await import("@/app/api/normalize/route");
    const req = new Request("http://localhost/api/normalize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings: [{ rawName: `ZZ Off ${stamp}`, canonicalScope: `Nope ${stamp}` }] }),
    });
    expect((await POST(req)).status).toBe(422);
  }, 30000);

  it("confirms, auto-maps exactly, learns across projects, and corrects", async () => {
    const raw = `ZZ Test Scope ${Date.now()}`;
    made.push(raw.trim().toLowerCase().replace(/\s+/g, " "));

    await confirmMapping(raw, A);
    const dict = await getDictionary();
    expect(dict.get(raw.trim().toLowerCase())).toBe(A);

    const res = await applyDictionary([{ name: raw }, { name: `${raw} unseen` }]);
    expect(res.mapped.length).toBe(1);
    expect(res.unmappedNames).toEqual([`${raw} unseen`]);

    expect(await getKnownScopes()).toContain(A);

    await confirmMapping(raw, B);
    const entry = await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: raw.trim().toLowerCase() } });
    expect(entry?.canonicalScope).toBe(B);
    expect(entry?.timesConfirmed).toBe(2);
  }, 30000);

  it("route persists posted mappings", async () => {
    const { POST } = await import("@/app/api/normalize/route");
    const raw = `ZZ Route Scope ${Date.now()}`;
    made.push(raw.trim().toLowerCase().replace(/\s+/g, " "));
    const req = new Request("http://localhost/api/normalize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings: [{ rawName: raw, canonicalScope: R }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const dict = await getDictionary();
    expect(dict.get(raw.trim().toLowerCase())).toBe(R);
  }, 30000);
});
