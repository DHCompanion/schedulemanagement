import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getSplitRules, addSplitRule, removeSplitRule } from "@/lib/completeness/splitRuleService";
import { SESSION_COOKIE } from "@/lib/auth";
import { signSession } from "@/lib/scope";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("splitRuleService", () => {
  const coarse = `ZZ Test Coarse ${Date.now()}`;
  process.env.SESSION_SIGNING_SECRET = process.env.SESSION_SIGNING_SECRET || "token-abc".padEnd(32, "x");

  afterAll(async () => {
    await prisma.scopeSplitRule.deleteMany({ where: { coarseScope: coarse } });
    await prisma.$disconnect();
  });

  it("adds rules, lists them, and removes one", async () => {
    await addSplitRule(coarse, "Finer B");
    await addSplitRule(coarse, "Finer A");

    const rules = await getSplitRules();
    expect(rules.get(coarse)).toEqual(["Finer A", "Finer B"]);

    await removeSplitRule(coarse, "Finer B");
    const after = await getSplitRules();
    expect(after.get(coarse)).toEqual(["Finer A"]);
  }, 30000);

  it("ignores blank input", async () => {
    await addSplitRule("  ", "  ");
    const rules = await getSplitRules();
    expect(rules.has("")).toBe(false);
  }, 15000);

  it("route adds and removes a rule", async () => {
    const { POST, DELETE } = await import("@/app/api/completeness/split-rules/route");
    const body = JSON.stringify({ coarseScope: coarse, finerScope: "Route Finer" });
    const adminCookie = `${SESSION_COOKIE}=${await signSession(true, Math.floor(Date.now() / 1000))}`;
    const adminHeaders = { "Content-Type": "application/json", Cookie: adminCookie };

    const postRes = await POST(new Request("http://localhost/api/completeness/split-rules", {
      method: "POST", headers: adminHeaders, body,
    }));
    expect(postRes.status).toBe(200);
    expect((await getSplitRules()).get(coarse)).toContain("Route Finer");

    const delRes = await DELETE(new Request("http://localhost/api/completeness/split-rules", {
      method: "DELETE", headers: adminHeaders, body,
    }));
    expect(delRes.status).toBe(200);
    expect((await getSplitRules()).get(coarse) ?? []).not.toContain("Route Finer");
  }, 30000);

  it("route rejects a missing coarseScope", async () => {
    const { POST } = await import("@/app/api/completeness/split-rules/route");
    const adminCookie = `${SESSION_COOKIE}=${await signSession(true, Math.floor(Date.now() / 1000))}`;
    const res = await POST(new Request("http://localhost/api/completeness/split-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ finerScope: "x" }),
    }));
    expect(res.status).toBe(422);
  });

  it("route rejects a non-admin session", async () => {
    const { POST } = await import("@/app/api/completeness/split-rules/route");
    const res = await POST(new Request("http://localhost/api/completeness/split-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coarseScope: coarse, finerScope: "Route Finer" }),
    }));
    expect(res.status).toBe(403);
    expect((await getSplitRules()).get(coarse) ?? []).not.toContain("Route Finer");
  });
});
