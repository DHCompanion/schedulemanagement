import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyDictionaryWith, confirmMapping, getDictionary, getKnownScopes, applyDictionary } from "@/lib/normalize/normalizationService";

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

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("normalizationService (db)", () => {
  const made: string[] = [];
  afterAll(async () => {
    if (made.length) await prisma.scopeDictionaryEntry.deleteMany({ where: { normalizedName: { in: made } } });
    await prisma.$disconnect();
  });

  it("confirms, auto-maps exactly, learns across projects, and corrects", async () => {
    const raw = `ZZ Test Scope ${Date.now()}`;
    made.push(raw.trim().toLowerCase().replace(/\s+/g, " "));

    await confirmMapping(raw, "Test Scope A");
    const dict = await getDictionary();
    expect(dict.get(raw.trim().toLowerCase())).toBe("Test Scope A");

    const res = await applyDictionary([{ name: raw }, { name: `${raw} unseen` }]);
    expect(res.mapped.length).toBe(1);
    expect(res.unmappedNames).toEqual([`${raw} unseen`]);

    expect(await getKnownScopes()).toContain("Test Scope A");

    await confirmMapping(raw, "Test Scope B");
    const entry = await prisma.scopeDictionaryEntry.findUnique({ where: { normalizedName: raw.trim().toLowerCase() } });
    expect(entry?.canonicalScope).toBe("Test Scope B");
    expect(entry?.timesConfirmed).toBe(2);
  }, 30000);

  it("route persists posted mappings", async () => {
    const { POST } = await import("@/app/api/normalize/route");
    const raw = `ZZ Route Scope ${Date.now()}`;
    made.push(raw.trim().toLowerCase().replace(/\s+/g, " "));
    const req = new Request("http://localhost/api/normalize", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings: [{ rawName: raw, canonicalScope: "Routed Scope" }] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const dict = await getDictionary();
    expect(dict.get(raw.trim().toLowerCase())).toBe("Routed Scope");
  }, 30000);
});
