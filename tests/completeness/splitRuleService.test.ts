import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { getSplitRules, addSplitRule, removeSplitRule } from "@/lib/completeness/splitRuleService";

const hasDb = !!process.env.DATABASE_URL;

describe.runIf(hasDb)("splitRuleService", () => {
  const coarse = `ZZ Test Coarse ${Date.now()}`;

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
});
